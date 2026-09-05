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
    String(
      name || "Bilibili Video"
    )
      .replace(
        /[<>:"/\\|?*\x00-\x1F]/g,
        "_"
      )
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, 100) ||
    "Bilibili Video"
  );
}

/*
 * Convert header object into FFmpeg format.
 */
function headersToFFmpeg(headers) {
  if (
    !headers ||
    typeof headers !== "object"
  ) {
    return "";
  }

  return Object.entries(headers)
    .map(
      ([key, value]) =>
        `${key}: ${String(value)}`
    )
    .join("\r\n") + "\r\n";
}

/*
 * Run FFmpeg.
 *
 * IMPORTANT:
 * - yt-dlp is NOT used here.
 * - Video is NOT re-encoded.
 * - Audio is NOT re-encoded.
 * - FFmpeg only muxes the streams.
 */
function runFFmpegToFile(
  videoUrl,
  audioUrl,
  videoHeaders,
  audioHeaders,
  outputFile
) {
  return new Promise(
    (resolve, reject) => {
      const videoHeaderText =
        headersToFFmpeg(
          videoHeaders
        );

      const audioHeaderText =
        headersToFFmpeg(
          audioHeaders
        );

      const args = [
        "-hide_banner",
        "-loglevel",
        "error",

        /*
         * VIDEO
         */
        "-headers",
        videoHeaderText,

        "-i",
        videoUrl,

        /*
         * AUDIO
         */
        "-headers",
        audioHeaderText,

        "-i",
        audioUrl,

        /*
         * Map video + audio.
         */
        "-map",
        "0:v:0",

        "-map",
        "1:a:0",

        /*
         * STREAM COPY.
         *
         * No re-encoding.
         */
        "-c:v",
        "copy",

        "-c:a",
        "copy",

        /*
         * Proper MP4 metadata placement.
         */
        "-movflags",
        "+faststart",

        /*
         * MP4 output.
         */
        "-f",
        "mp4",

        outputFile,
      ];

      console.log(
        "[BiliSave] FFmpeg stream-copy started..."
      );

      const child =
        spawn(
          "ffmpeg",
          args,
          {
            stdio: [
              "ignore",
              "ignore",
              "pipe",
            ],
          }
        );

      let stderr = "";

      child.stderr.on(
        "data",
        (data) => {
          stderr +=
            data.toString();

          if (
            stderr.length >
            12000
          ) {
            stderr =
              stderr.slice(
                -12000
              );
          }
        }
      );

      child.on(
        "error",
        (error) => {
          reject(error);
        }
      );

      child.on(
        "close",
        (code) => {
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
        }
      );
    }
  );
}

export default async function handler(
  req,
  res
) {
  if (req.method !== "GET") {
    res.setHeader(
      "Allow",
      "GET"
    );

    return res.status(405).json({
      success: false,
      error:
        "Method not allowed",
    });
  }

  const title =
    typeof req.query?.title ===
    "string"
      ? req.query.title
      : "Bilibili Video";

  const safeTitle =
    safeFilename(title);

  /*
   * ==========================================
   * DIRECT DOWNLOAD
   * ==========================================
   */
  const directUrl =
    typeof req.query
      ?.directUrl === "string"
      ? req.query.directUrl
      : "";

  let directHeaders = {};

  try {
    if (
      typeof req.query
        ?.directHeaders ===
      "string"
    ) {
      directHeaders =
        JSON.parse(
          req.query.directHeaders
        );
    }
  } catch {
    directHeaders = {};
  }

  /*
   * ==========================================
   * SEPARATE STREAMS
   * ==========================================
   */
  const videoUrl =
    typeof req.query
      ?.videoUrl === "string"
      ? req.query.videoUrl
      : "";

  const audioUrl =
    typeof req.query
      ?.audioUrl === "string"
      ? req.query.audioUrl
      : "";

  let videoHeaders = {};
  let audioHeaders = {};

  try {
    if (
      typeof req.query
        ?.videoHeaders ===
      "string"
    ) {
      videoHeaders =
        JSON.parse(
          req.query.videoHeaders
        );
    }

    if (
      typeof req.query
        ?.audioHeaders ===
      "string"
    ) {
      audioHeaders =
        JSON.parse(
          req.query.audioHeaders
        );
    }
  } catch {
    videoHeaders = {};
    audioHeaders = {};
  }

  /*
   * ==========================================
   * CASE 1: DIRECT STREAM
   * ==========================================
   */
  if (directUrl) {
    console.log(
      "[BiliSave] Direct CDN download..."
    );

    /*
     * Direct browser redirect may still
     * be blocked by CDN because browser
     * cannot attach custom headers.
     *
     * Therefore return a clear response.
     */
    return res.status(400).json({
      success: false,
      error:
        "Direct stream requires server download.",
    });
  }

  /*
   * ==========================================
   * CASE 2: VIDEO + AUDIO
   * ==========================================
   */
  if (
    !videoUrl ||
    !audioUrl
  ) {
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
     * Unique temporary MP4.
     */
    const randomId =
      crypto
        .randomBytes(12)
        .toString("hex");

    tempFile =
      path.join(
        os.tmpdir(),
        `bili-${randomId}.mp4`
      );

    /*
     * FFmpeg creates COMPLETE MP4.
     */
    await runFFmpegToFile(
      videoUrl,
      audioUrl,
      videoHeaders,
      audioHeaders,
      tempFile
    );

    /*
     * Verify output.
     */
    if (
      !fs.existsSync(
        tempFile
      )
    ) {
      throw new Error(
        "FFmpeg output file was not created."
      );
    }

    const stat =
      fs.statSync(
        tempFile
      );

    if (stat.size < 1024) {
      throw new Error(
        "Generated MP4 is empty or invalid."
      );
    }

    console.log(
      `[BiliSave] Final MP4 size: ${stat.size} bytes`
    );

    /*
     * Browser receives ONLY AFTER
     * FFmpeg has finished.
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
     * Send finalized MP4.
     */
    await new Promise(
      (resolve, reject) => {
        const stream =
          fs.createReadStream(
            tempFile
          );

        stream.on(
          "error",
          reject
        );

        stream.on(
          "end",
          resolve
        );

        stream.pipe(res);
      }
    );

    console.log(
      "[BiliSave] MP4 sent to browser successfully."
    );
  } catch (error) {
    console.error(
      "[BiliSave] Download error:",
      error
    );

    if (
      !res.headersSent
    ) {
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
     * Delete temporary MP4.
     */
    if (
      tempFile &&
      fs.existsSync(
        tempFile
      )
    ) {
      try {
        fs.unlinkSync(
          tempFile
        );

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
