export default async function handler(req, res) {
  const { url } = req.query;

  if (!url) {
    return res.status(400).json({ error: 'URL is required' });
  }

  try {
    // స్క్రీన్ షాట్‌లో ఉన్న మీ RapidAPI వివరాలతో ఇక్కడ ఫెచ్ చేయాలి
    const apiResponse = await fetch(`https://<YOUR-RAPIDAPI-HOST-URL>?url=${encodeURIComponent(url)}`, {
      method: 'GET',
      headers: {
        'X-RapidAPI-Key': 'YOUR_RAPIDAPI_KEY_இక్కడ_పెట్టండి',
        'X-RapidAPI-Host': 'YOUR_RAPIDAPI_HOST_ఇక్కడ_పెట్టండి'
      }
    });

    const data = await apiResponse.json();
    
    // API నుండి వచ్చిన రెస్పాన్స్‌ను ఫ్రంట్‌ఎండ్‌కి పంపిస్తున్నాం
    return res.status(200).json(data);

  } catch (error) {
    console.error(error);
    return res.status(500).json({ error: 'Failed to fetch video data from RapidAPI' });
  }
}
