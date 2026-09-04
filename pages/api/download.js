// Actually downloads the video server-side with yt-dlp (merging Bilibili's
// separate video+audio streams via ffmpeg into one mp4), then streams the
// resulting file to the browser and cleans up the temp file afterwards.
import { spawn } from 'child_process';
import fs from 'fs';
import os from 'os';
import path from 'path';
import crypto from 'crypto';

export const config = {
  api: {
    responseLimit: false,
  },
};

export default async function handler(req, res) {
  const { url, title } = req.query;

  if (!url || typeof url !== 'string') {
    return res.status(400).json({ error: 'Invalid or missing url' });
  }

  const id = crypto.randomBytes(6).toString('hex');
  const outTemplate = path.join(os.tmpdir(), `${id}.%(ext)s`);
  const finalPath = path.join(os.tmpdir(), `${id}.mp4`);

  const ytdlp = spawn('yt-dlp', [
    '--no-warnings',
    '--no-playlist',
    '-f', 'bv*+ba/b',
    '--merge-output-format', 'mp4',
    '-o', outTemplate,
    url,
  ]);

  let stderr = '';
  ytdlp.stderr.on('data', (chunk) => {
    stderr += chunk.toString();
  });

  ytdlp.on('error', (err) => {
    console.error('Failed to start yt-dlp:', err);
    if (!res.headersSent) {
      res.status(500).json({ error: 'Failed to start downloader.' });
    }
  });

  ytdlp.on('close', (code) => {
    if (code !== 0) {
      console.error(stderr);
      if (!res.headersSent) {
        res.status(500).json({ error: 'Download failed.', details: stderr.slice(0, 500) });
      }
      return;
    }

    if (!fs.existsSync(finalPath)) {
      if (!res.headersSent) {
        res.status(500).json({ error: 'Downloaded file not found.' });
      }
      return;
    }

    const safeName = (title || 'video').toString().replace(/[^\w\-. ]/g, '_');
    const stat = fs.statSync(finalPath);

    res.setHeader('Content-Type', 'video/mp4');
    res.setHeader('Content-Disposition', `attachment; filename="${safeName}.mp4"`);
    res.setHeader('Content-Length', stat.size);

    const stream = fs.createReadStream(finalPath);
    stream.pipe(res);
    stream.on('close', () => {
      fs.unlink(finalPath, () => {});
    });
    stream.on('error', (err) => {
      console.error(err);
      fs.unlink(finalPath, () => {});
    });
  });
}

