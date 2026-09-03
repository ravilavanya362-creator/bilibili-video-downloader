export default async function handler(req, res) {
  const { url } = req.query;

  if (!url) {
    return res.status(400).json({ error: 'URL is required' });
  }

  try {
    // RapidAPI ద్వారా Bilibili డేటాను ఫెచ్ చేయడం
    const apiResponse = await fetch(`https://<YOUR-RAPIDAPI-HOST-URL>?url=${encodeURIComponent(url)}`, {
      method: 'GET',
      headers: {
        'X-RapidAPI-Key': 'మీ_రాపిడ్_ఏపీఐ_కీ_ఇక్కడ_రాయండి',
        'X-RapidAPI-Host': 'మీ_రాపిడ్_ఏపీఐ_హోస్ట్_ఇక్కడ_రాయండి'
      }
    });

    const data = await apiResponse.json();
    return res.status(200).json(data);

  } catch (error) {
    console.error(error);
    return res.status(500).json({ error: 'Failed to fetch video data from RapidAPI' });
  }
}
