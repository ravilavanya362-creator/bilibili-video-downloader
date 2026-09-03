export default async function handler(req, res) {
  const { url } = req.query;

  if (!url) {
    return res.status(400).json({ error: 'URL is required' });
  }

  try {
    // Apify Bilibili Video Scraper యాక్టర్‌ను టోకెన్‌తో రన్ చేయడానికి లింక్
    const actorId = 'INPUT_YOUR_ACTOR_ID'; // లేదా మీరు వాడే యాక్టర్ ఎండ్‌పాయింట్
    const apifyUrl = `https://api.apify.com/v2/acts/apify~bilibili-scraper/runs?token=apify_api_mBomVDgnM4cKm5oSEYtdrWD3djY8sU2kNRJi`;

    const apiResponse = await fetch(apifyUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        startUrls: [{ url: url }]
      })
    });

    const runData = await apiResponse.json();
    
    // రన్ అయిన తర్వాత డేటా తెచ్చుకోవడానికి 
    if (runData && runData.data && runData.data.defaultDatasetId) {
      const datasetId = runData.data.defaultDatasetId;
      const datasetRes = await fetch(`https://api.apify.com/v2/datasets/${datasetId}/items?token=apify_api_mBomVDgnM4cKm5oSEYtdrWD3djY8sU2kNRJi&clean=true`);
      const items = await datasetRes.json();
      
      return res.status(200).json({ success: true, data: items });
    }

    return res.status(200).json({ success: true, message: "Scraper started", runData });

  } catch (error) {
    console.error(error);
    return res.status(500).json({ error: 'Failed to fetch data from Apify' });
  }
}
