export default async function handler(req, res) {
  const { url } = req.query;

  if (!url) {
    return res.status(400).json({ error: 'URL is required' });
  }

  try {
    const token = process.env.APIFY_TOKEN;
    
    // zhorex/bilibili-scraper యాక్టర్‌ని లింక్‌తో ట్రిగ్గర్ చేయడం
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
      
      // స్క్రాపింగ్ కంప్లీట్ కావడానికి 6 సెకండ్లు వెయిట్ చేయడం
      await new Promise(resolve => setTimeout(resolve, 6000));

      const datasetRes = await fetch(`https://api.apify.com/v2/datasets/${datasetId}/items?token=${token}&clean=true`);
      const items = await datasetRes.json();
      
      return res.status(200).json({ success: true, data: items });
    }

    return res.status(200).json({ success: false, error: "Failed to trigger scraper", runData });

  } catch (error) {
    console.error(error);
    return res.status(500).json({ error: 'Internal server error' });
  }
}
