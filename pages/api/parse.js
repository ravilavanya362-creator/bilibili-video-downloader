export default async function handler(req, res) {
  const { url } = req.query;

  if (!url) {
    return res.status(400).json({ error: 'URL is required' });
  }

  try {
    const token = process.env.APIFY_TOKEN;
    const actorId = 'zhorex~bilibili-scraper';
    const runUrl = `https://api.apify.com/v2/acts/${actorId}/runs?token=${token}`;

    const apiResponse = await fetch(runUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        startUrls: [{ url: url }]
      })
    });

    const runData = await apiResponse.json();
    
    if (runData && runData.data && runData.data.defaultDatasetId) {
      const datasetId = runData.data.defaultDatasetId;
      const runId = runData.data.id;
      
      // స్క్రాపర్ రన్ అయ్యి డేటా వచ్చే వరకు 8 సెకండ్లు వెయిట్ చేద్దాం
      await new Promise(resolve => setTimeout(resolve, 8000));

      const datasetRes = await fetch(`https://api.apify.com/v2/datasets/${datasetId}/items?token=${token}&clean=true`);
      const items = await datasetRes.json();
      
      if (items.length === 0) {
        const runStatusRes = await fetch(`https://api.apify.com/v2/actor-runs/${runId}?token=${token}`);
        const runStatusData = await runStatusRes.json();
        return res.status(200).json({ 
          success: false, 
          message: "Scraper finished but returned empty data", 
          apifyRunStatus: runStatusData.data.status,
          actorPricingOrError: runStatusData.data 
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
