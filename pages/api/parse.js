export default async function handler(req, res) {
  const { url } = req.query;

  if (!url) {
    return res.status(400).json({ error: 'URL is required' });
  }

  try {
    const token = process.env.APIFY_TOKEN;
    
    // ఇక్కడ 'YOUR_ACTOR_NAME' బదులుగా మీ Apify యాక్టర్ అసలైన పేరు లేదా ID రాయండి 
    // (ఉదాహరణకు మీరు Apify లో ఉపయోగిస్తున్న యాక్టర్ పేరు)
    const actorName = 'YOUR_ACTOR_NAME'; // <--- ఇక్కడ మీ యాక్టర్ పేరు ఇవ్వండి
    const runUrl = `https://api.apify.com/v2/acts/${actorName}/runs?token=${token}`;

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
      const datasetRes = await fetch(`https://api.apify.com/v2/datasets/${datasetId}/items?token=${token}&clean=true`);
      const items = await datasetRes.json();
      
      return res.status(200).json({ success: true, data: items });
    }

    return res.status(200).json({ success: true, message: "Job started successfully", runData });

  } catch (error) {
    console.error(error);
    return res.status(500).json({ error: 'Failed to fetch data from Apify' });
  }
}
