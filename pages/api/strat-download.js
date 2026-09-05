// Kicks off yt-dlp in the background and returns immediately with a jobId.
// This avoids holding one long-lived HTTP connection open while yt-dlp
// downloads+merges (which was getting killed by Render's idle-connection
// timeout, causing ERR_STREAM_PREMATURE_CLOSE). The client polls
// /api/job-status and only fetches /api/job-file once the file is ready.
import { spawn } from 'child_process';
import fs from 'fs';
import os from 'os';
import path from 'path';
import crypto from 'crypto';
import { jobs } from '../../lib/jobs';

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { url, title } = req.body || {};
  if (!url || typeof url !== 'string') {
    return res.status(400).json({ error: 'Invalid or missing url' });
  }

  const jobId = crypto.randomBytes(8).toString('hex');
  const outTemplate = path.join(os.tmpdir(), `${jobId}.%(ext)s`);
  const finalPath = path.join(os.tmpdir(), `${jobId}.mp4`);

  jobs.set(jobId, { status: 'processing', title: title || 'video', createdAt: Date.now() });

  const ytdlp = spawn('yt-dlp', [
    '--no-warnings',
    '--no-playlist',
    '-f', req.body.hd === true ? 'bv*+ba/b' : 'bv*[height<=720]+ba/b[height<=720]',
    '--merge-output-format', 'mp4',
    '-o', outTemplate,
    url,
  ]);

  let stderr = '';
  ytdlp.stderr.on('data', (chunk) => {
    stderr += chunk.toString();
  });

  // yt-dlp prints download progress lines like:
  // "[download]  45.2% of 66.61MiB at 1.20MiB/s ETA 00:14"
  // Parse the percentage so the frontend can show live progress instead
  // of a static "please wait" message.
  let stdoutBuf = '';
  ytdlp.stdout.on('data', (chunk) => {
    stdoutBuf += chunk.toString();
    const lines = stdoutBuf.split('\r').join('\n').split('\n');
    stdoutBuf = lines.pop(); // keep any incomplete trailing line
    for (const line of lines) {
      const match = line.match(/\[download\]\s+([\d.]+)%/);
      if (match) {
        const pct = parseFloat(match[1]);
        const current = jobs.get(jobId) || {};
        jobs.set(jobId, { ...current, status: 'processing', progress: pct });
      } else if (/\[Merger\]|Merging formats/.test(line)) {
        const current = jobs.get(jobId) || {};
        jobs.set(jobId, { ...current, status: 'merging', progress: 100 });
      }
    }
  });

  ytdlp.on('error', (err) => {
    jobs.set(jobId, { status: 'error', message: err.message });
  });

  ytdlp.on('close', (code) => {
    if (code !== 0) {
      console.error(stderr);
      jobs.set(jobId, { status: 'error', message: stderr.slice(0, 500) || 'Download failed.' });
      return;
    }
    if (!fs.existsSync(finalPath)) {
      jobs.set(jobId, { status: 'error', message: 'Downloaded file not found.' });
      return;
    }
    jobs.set(jobId, { status: 'done', filePath: finalPath, title: title || 'video' });
  });

  // Respond immediately - the actual work continues in the background.
  return res.status(200).json({ jobId });
}
