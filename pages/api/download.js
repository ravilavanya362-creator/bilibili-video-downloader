import { spawn } from "child_process";
import fs from "fs";

export const config = {
  api: {
    responseLimit: false,
    bodyParser: true,
  },
};

function safeFilename(name) {
  return (
    String(name || "Bilibili Video")
      .replace(/[<>:"/\\|?*\x00-\x1F]/g, "_")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, 100) ||
    "Bilibili Video"
  );
}

function runFFmpeg(videoUrl, audioUrl, res) {
  return new Promise((resolve, reject) => {
    const args = [
      "-hide_banner",
      "-loglevel",
      "error",

      "-i",
      videoUrl,

      "-i",
      audioUrl,

      "-map",
      "0:v:0",

      "-map",
      "1:a:0",

      "-c:v",
      "copy",

      "-c:a",
      "copy",

      "-movflags",
      "frag_keyframe+empty_moov",

      "-f",
      "mp4",

      "pipe:1",
    ];

    console.log(
      "[BiliSave] FFmpeg stream-copy started..."
    );

    const child = spawn(
      "ffmpeg",
      args,
      {
        stdio: ["ignore", "pipe", "pipe"],
      }
    );

    let stderr = "";

    child.stderr.on("data", (data) => {
      stderr += data.toString();

      if (stderr.length > 10000) {
        stderr = stderr.slice(-10000);
      }
    });

    child.on("error", (error) => {
      reject(error);
    });

    child.stdout.pipe(res);

    child.on("close", (code) => {
      if (code !== 0) {
        reject(
          new Error(
            stderr.trim() ||
              "FFmpeg could not create the MP4."
          )
        );
        return;
      }

      resolve();
    });

    res.on("close", () => {
      if (!child.killed) {
        child.kill("SIGTERM");
      }
    });
  });
}

export default async function handler(req, res) {
  if (req.method !== "GET") {
    res.setHeader("Allow", "GET");

    return res.status(405).json({
      error: "Method not allowed",
    });
  }

  const directUrl =
    typeof req.query?.directUrl === "string"
      ? req.query.directUrl
      : "";

  const videoUrl =
    typeof req.query?.videoUrl === "string"
      ? req.query.videoUrl
      : "";

  const audioUrl =
    typeof req.query?.audioUrl === "string"
      ? req.query.audioUrl
      : "";

  const title =
    typeof req.query?.title === "string"
      ? req.query.title
      : "Bilibili Video";

  const safeTitle = safeFilename(title);

  /*
   * CASE 1:
   * Combined video + audio.
   *
   * No FFmpeg.
   * No yt-dlp.
   * Direct CDN redirect.
   */
  if (directUrl) {
    console.log(
      "[BiliSave] Direct CDN download..."
    );

    res.setHeader(
      "Content-Disposition",
      `attachment; filename="Bilibili-Video.mp4"; filename*=UTF-8''${encodeURIComponent(
        safeTitle + ".mp4"
      )}`
    );

    res.setHeader(
      "Cache-Control",
      "no-store"
    );

    return res.redirect(302, directUrl);
  }

  /*
   * CASE 2:
   * Separate video + audio.
   *
   * FFmpeg combines them without re-encoding.
   */
  if (!videoUrl || !audioUrl) {
    return res.status(400).json({
      success: false,
      error:
        "Video or audio stream is missing.",
    });
  }

  try {
    console.log(
      "[BiliSave] Separate streams detected."
    );

    console.log(
      "[BiliSave] Starting FFmpeg stream-copy..."
    );

    res.statusCode = 200;

    res.setHeader(
      "Content-Type",
      "video/mp4"
    );

    res.setHeader(
      "Content-Disposition",
      `attachment; filename="Bilibili-Video.mp4"; filename*=UTF-8''${encodeURIComponent(
        safeTitle + ".mp4"
      )}`
    );

    res.setHeader(
      "Cache-Control",
      "no-store, no-cache, must-revalidate"
    );

    res.setHeader(
      "X-Content-Type-Options",
      "nosniff"
    );

    await runFFmpeg(
      videoUrl,
      audioUrl,
      res
    );

    console.log(
      "[BiliSave] MP4 stream completed."
    );
  } catch (error) {
    console.error(
      "[BiliSave] FFmpeg error:",
      error
    );

    if (!res.headersSent) {
      return res.status(500).json({
        success: false,
        error:
          "Could not create the MP4 video.",
      });
    }

    if (!res.destroyed) {
      res.destroy();
    }
  }
}
