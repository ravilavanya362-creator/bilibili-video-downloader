// Bilibili share links are often shortened (b23.tv/xxxx) or carry tracking
// query params. The scraper actor's 'video_detail' mode only recognizes a
// canonical bilibili.com/video/BVxxxxxxxxxx URL, so we resolve redirects
// and strip everything down to that canonical form before calling it.
async function resolveToCanonicalVideoUrl(inputUrl) {
  let current = inputUrl;

  // Follow up to 5 redirects manually so we can inspect the final Location
  // even if bilibili's server ever stops sending a fully-qualified URL.
  for (let i = 0; i < 5; i++) {
    const match = current.match(/BV[0-9A-Za-z]{10}/);
    if (match) {
      return `https://www.bilibili.com/video/${match[0]}`;
    }

    let response;
    try {
      response = await fetch(current, { method: 'GET', redirect: 'manual' });
    } catch (e) {
      break;
    }

    const location = response.headers.get('location');
    if (!location) break;

    current = new URL(location, current).toString();
  }

  const finalMatch = current.match(/BV[0-9A-Za-z]{10}/);
  return finalMatch ? `https://www.bilibili.com/video/${finalMatch[0]}` : current;
}

export default async function handler(req, res) {
  const url = req.method === 'POST' ? req.body?.url : req.query.url;

  if (!url) {
    return res.status(400).json({ error: 'URL is required' });
  }

  try {
    const canonicalUrl = await resolveToCanonicalVideoUrl(url);

    const token = process.env.APIFY_TOKEN;
    const actorId = 'zhorex~bilibili-scraper';
    const runUrl = `https://api.apify.com/v2/acts/${actorId}/runs?token=${token}`;

    const apiResponse = await fetch(runUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        videoUrls: [canonicalUrl],
        mode: "video_detail",
      })
    });

    const runData = await apiResponse.json();
    
    if (runData && runData.data && runData.data.defaultDatasetId) {
      const datasetId = runData.data.defaultDatasetId;
      const runId = runData.data.id;
      
      await new Promise(resolve => setTimeout(resolve, 8000));

      const datasetRes = await fetch(`https://api.apify.com/v2/datasets/${datasetId}/items?token=${token}&clean=true`);
      const items = await datasetRes.json();
      
      if (items.length === 0) {
        const runStatusRes = await fetch(`https://api.apify.com/v2/actor-runs/${runId}?token=${token}`);
        const runStatusData = await runStatusRes.json();
        return res.status(200).json({ 
          success: false, 
          message: "Scraper finished but returned empty data", 
          statusMessage: runStatusData.data.statusMessage || "0 items found",
          resolvedUrl: canonicalUrl,
          actorRunDetails: runStatusData.data 
        });
      }
      
      return res.status(200).json({ success: true, data: items });
    }

    return res.status(200).json({ success: false, error: "Failed to start actor run", runData });

  } catch (error) {
    console.error(error);
    return res.status(500).json({ error: error.message });
  }
}
