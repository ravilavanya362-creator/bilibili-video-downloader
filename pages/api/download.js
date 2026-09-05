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
   * Then Node sends the completed file to browser.
   */

  if (!videoUrl || !audioUrl) {
    return res.status(400).json({
      success: false,
      error:
        "Video or audio stream is missing.",
    });
  }

  let tempFile = null;

  try {
    console.log(
      "[BiliSave] Separate streams detected."
    );

    /*
     * Create unique temporary MP4 file.
     */
    const randomId =
      crypto.randomBytes(12).toString("hex");

    tempFile = path.join(
      os.tmpdir(),
      `bili-${randomId}.mp4`
    );

    console.log(
      "[BiliSave] Temporary file:",
      tempFile
    );

    /*
     * FFmpeg creates the COMPLETE MP4 first.
     */
    await runFFmpegToFile(
      videoUrl,
      audioUrl,
      tempFile
    );

    /*
     * Verify file exists.
     */
    if (!fs.existsSync(tempFile)) {
      throw new Error(
        "FFmpeg output file was not created."
      );
    }

    const stat =
      fs.statSync(tempFile);

    if (stat.size < 1024) {
      throw new Error(
        "Generated MP4 file is invalid or empty."
      );
    }

    console.log(
      `[BiliSave] Final MP4 size: ${stat.size} bytes`
    );

    /*
     * IMPORTANT:
     *
     * Do NOT start browser download until
     * FFmpeg has completely finished.
     *
     * This prevents the previous 00:00 MP4 problem.
     */
    res.statusCode = 200;

    res.setHeader(
      "Content-Type",
      "video/mp4"
    );

    res.setHeader(
      "Content-Length",
      stat.size
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
      "Pragma",
      "no-cache"
    );

    res.setHeader(
      "X-Content-Type-Options",
      "nosniff"
    );

    /*
     * Send the finalized MP4.
     */
    await new Promise((resolve, reject) => {
      const readStream =
        fs.createReadStream(tempFile);

      readStream.on("error", reject);

      readStream.on("end", resolve);

      readStream.pipe(res);
    });

    console.log(
      "[BiliSave] MP4 sent to browser successfully."
    );
  } catch (error) {
    console.error(
      "[BiliSave] Download error:",
      error
    );

    if (!res.headersSent) {
      return res.status(500).json({
        success: false,
        error:
          error.message ||
          "Could not create the MP4 video.",
      });
    }

    if (!res.destroyed) {
      res.destroy();
    }
  } finally {
    /*
     * Always delete temporary MP4
     * after sending / error.
     */
    if (
      tempFile &&
      fs.existsSync(tempFile)
    ) {
      try {
        fs.unlinkSync(tempFile);

        console.log(
          "[BiliSave] Temporary MP4 deleted."
        );
      } catch (cleanupError) {
        console.error(
          "[BiliSave] Temporary file cleanup failed:",
          cleanupError
        );
      }
    }
  }
}
