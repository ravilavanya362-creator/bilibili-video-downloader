export default async function handler(req, res) {
  const { url } = req.query;

  if (!url) {
    return res.status(400).json({ error: 'URL is required' });
  }

  try {
    const token = process.env.APIFY_TOKEN;
    
    // 1. యూజర్ ఇచ్చిన లింక్‌తో Bilibili స్క్రాపర్ యాక్టర్‌ని ట్రిగ్గర్ చేయడం
    const runUrl = `https://api.apify.com/v2/acts/apify~bilibili-scraper/runs?token=${token}`;

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
    
    // 2. యాక్టర్ సక్సెస్ ఫుల్‌గా రన్ అయితే, జనరేట్ అయిన defaultDatasetId ను తీసుకోవడం
    if (runData && runData.data && runData.data.defaultDatasetId) {
      const datasetId = runData.data.defaultDatasetId;
      
      // స్క్రాపింగ్ పూర్తి కావడానికి చిన్న వెయిటింగ్ (కొన్ని సెకన్లు)
      await new Promise(resolve => setTimeout(resolve, 5000));

      // 3. ఆ డేటాసెట్ నుండి వీడియో వివరాలను ఫెచ్ చేయడం
      const datasetRes = await fetch(`https://api.apify.com/v2/datasets/${datasetId}/items?token=${token}&clean=true`);
      const items = await datasetRes.json();
      
      return res.status(200).json({ success: true, data: items });
    }

    return res.status(400).json({ success: false, error: "Failed to start scraper run", runData });

  } catch (error) {
    console.error(error);
    return res.status(500).json({ error: 'Internal server error' });
  }
}

