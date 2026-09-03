import { useEffect, useState } from 'react';
import { useRouter } from 'next/router';
import Head from 'next/head';

export default function Home() {
  const router = useRouter();
  const [videoUrl, setVideoUrl] = useState('');
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState(null);

  useEffect(() => {
    if (router.query.url) {
      const targetUrl = decodeURIComponent(router.query.url);
      setVideoUrl(targetUrl);
    }
  }, [router.query]);

  const handleParse = async (e) => {
    e.preventDefault();
    if (!videoUrl) {
      alert('దయచేసి Bilibili లింక్‌ని ఎంటర్ చేయండి!');
      return;
    }
    setLoading(true);
    setResult(null);

    try {
      const res = await fetch(`/api/parse?url=${encodeURIComponent(videoUrl)}`);
      const data = await res.json();
      setResult(data);
    } catch (err) {
      console.error(err);
      alert('వీడియో లింక్‌ని ప్రాసెస్ చేయడంలో విఫలమైంది.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div style={{ padding: '2rem', fontFamily: 'Arial, sans-serif', maxWidth: '600px', margin: 'auto' }}>
      <Head>
        <title>Bilibili Video Downloader</title>
      </Head>
      <h1 style={{ textAlign: 'center' }}>Bilibili Video Downloader</h1>
      
      <form onSubmit={handleParse} style={{ display: 'flex', gap: '10px', marginBottom: '20px', marginTop: '20px' }}>
        <input
          type="text"
          value={videoUrl}
          onChange={(e) => setVideoUrl(e.target.value)}
          placeholder="Bilibili లింక్‌ని ఇక్కడ పేస్ట్ చేయండి..."
          style={{ flex: 1, padding: '12px', fontSize: '16px', borderRadius: '5px', border: '1px solid #ccc' }}
        />
        <button type="submit" disabled={loading} style={{ padding: '12px 20px', fontSize: '16px', cursor: 'pointer', background: '#ff4757', color: 'white', border: 'none', borderRadius: '5px' }}>
          {loading ? 'Processing...' : 'Download Now 🚀'}
        </button>
      </form>

      {result && (
        <div style={{ background: '#f4f4f4', padding: '15px', borderRadius: '5px', marginTop: '20px' }}>
          <h3>Result:</h3>
          <pre style={{ whiteSpace: 'pre-wrap', wordBreak: 'break-all', background: '#fff', padding: '10px', border: '1px solid #ddd' }}>
            {JSON.stringify(result, null, 2)}
          </pre>
        </div>
      )}
    </div>
  );
}
