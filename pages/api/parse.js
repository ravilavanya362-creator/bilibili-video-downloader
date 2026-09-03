export default async function handler(req, res) {
  const { url } = req.query;

  if (!url) {
    return res.status(400).json({ error: 'URL is required' });
  }

  try {
    const token = process.env.APIFY_TOKEN;
    
    // స్క్రీన్ షాట్‌లో ఉన్న మీ యాక్టర్ రన్ ఐడి ఆధారంగా డైరెక్ట్ డేటాసెట్ ఎండ్‌పాయింట్
    // (లేదా మీ లేటెస్ట్ రన్ తాలూకు డేటాసెట్ ఐటమ్స్ లింక్)
    const datasetUrl = `https://api.apify.com/v2/datasets/dMUifVHUdrI6SEKHw/items?token=${token}&clean=true`;

    const apiResponse = await fetch(datasetUrl, {
      method: 'GET',
      headers: {
        'Content-Type': 'application/json',
      }
    });

    const items = await apiResponse.json();
    
    return res.status(200).json({ success: true, data: items });

  } catch (error) {
    console.error(error);
    return res.status(500).json({ error: 'Failed to fetch data from Apify' });
  }
}
