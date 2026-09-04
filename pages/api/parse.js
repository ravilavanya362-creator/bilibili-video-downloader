// Uses yt-dlp (installed system-wide in the Docker image) to fetch
// metadata for a Bilibili video. yt-dlp natively resolves b23.tv short
// links and handles Bilibili's DASH (split video/audio) streams.
import { execFile } from 'child_process';
import { promisify } from 'util';

const execFileAsync = promisify(execFile);

export default async function handler(req, res) {
  const url = req.method === 'POST' ? req.body?.url : req.query.url;

  if (!url) {
    return res.status(400).json({ error: 'URL is required' });
  }

  try {
    const { stdout } = await execFileAsync(
      'yt-dlp',
      ['--no-warnings', '--dump-json', '--no-playlist', url],
      { timeout: 60000, maxBuffer: 1024 * 1024 * 20 }
    );

    // yt-dlp prints one JSON object per line; take the first (the video).
    const firstLine = stdout.trim().split('\n')[0];
    const info = JSON.parse(firstLine);

    return res.status(200).json({
      success: true,
      title: info.title || 'Bilibili Video',
      thumbnail: info.thumbnail || null,
      duration: info.duration || null,
      videoUrl: url,
    });
  } catch (error) {
    console.error(error);
    const stderr = (error.stderr || error.message || '').toString();
    return res.status(200).json({
      success: false,
      message: 'Could not fetch video details. The video may be private, deleted, or region-locked.',
      details: stderr.slice(0, 500),
    });
  }
}
