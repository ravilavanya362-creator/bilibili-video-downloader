import { spawn } from "child_process";
import fs from "fs";
import os from "os";
import path from "path";
import crypto from "crypto";

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
      .slice(0, 100) || "Bilibili Video"
  );
}

function runFFmpegToFile(videoUrl, audioUrl, outputFile) {
  return new Promise((resolve, reject) => {
    const args = [
      "-hide_banner",
      "-loglevel",
      "error",

      // Video stream
      "-i",
      videoUrl,

      // Audio stream
      "-i",
      audioUrl,

      // Select video + audio
      "-map",
      "0:v:0",
      "-map",
      "1:a:0",

      // IMPORTANT:
      // No re-encoding
      "-c:v",
      "copy",

      "-c:a",
      "copy",

      // Create a proper MP4 file
      "-movflags",
      "+faststart",

      "-f",
      "mp4",

      outputFile,
    ];

    console.log(
      "[BiliSave] FFmpeg stream-copy started..."
    );

    const child = spawn("ffmpeg", args, {
      stdio: ["ignore", "ignore", "pipe"],
    });

    let stderr = "";

    child.stderr.on("data", (data) => {
      stderr += data.toString();

      if (stderr.length > 12000) {
        stderr = stderr.slice(-12000);
      }
    });

    child.on("error", (error) => {
      reject(error);
    });

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

      console.log(
        "[BiliSave] FFmpeg MP4 finalized successfully."
      );

      resolve();
    });
  });
}

export default async function handler(req, res) {
  if (req.method !== "GET") {
    res.setHeader("Allow", "GET");

    return res.status(405).json({
      success: false,
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
   * =====================================================
   * CASE 1: DIRECT STREAM
   * =====================================================
   *
   * Video + audio already combined.
   *
   * No FFmpeg.
   * No yt-dlp.
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
      "Content-Type",
      "video/mp4"
    );

    res.setHeader(
      "Cache-Control",
      "no-store, no-cache, must-revalidate"
    );

    return res.redirect(302, directUrl);
  }

  /*
   * =====================================================
   * CASE 2: SEPARATE VIDEO + AUDIO
   * =====================================================
   *
   * Video and audio are separate.
   *
   * FFmpeg:
   *   - does NOT re-encode
   *   - only muxes video + audio
   *   - creates a real MP4 file
   *   - finalizes MP4 metadata/index
   *
   * Then Node sends the completed file to browser
