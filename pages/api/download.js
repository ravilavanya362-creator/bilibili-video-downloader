import { spawn } from "child_process";
import fs from "fs";
import path from "path";
import os from "os";
import crypto from "crypto";

export const config = {
  api: {
    responseLimit: false,
    bodyParser: false,
  },
};

function isBilibiliUrl(value) {
  try {
    const u = new URL(value);
    const host = u.hostname.toLowerCase();

    return (
      host === "b23.tv" ||
      host === "www.b23.tv" ||
      host === "bilibili.com" ||
      host === "www.bilibili.com" ||
      host.endsWith(".bilibili.com")
    );
  } catch {
    return false;
  }
}

function safeFilename(name) {
  return (
    String(name || "Bilibili Video")
      .replace(/[<>:"/\\|?*\x00-\x1F]/g, "_")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, 100) || "Bilibili Video"
  );
}

function runYtDlp(url, outputFile) {
  return new Promise((resolve, reject) => {
    const args = [
      "--no-playlist",
      "--no-warnings",

      "--retries",
      "3",

      "--fragment-retries",
      "3",

      "--socket-timeout",
      "30",

      "--add-header",
      "Referer: https://www.bilibili.com/",

      "--add-header",
      "Origin: https://www.bilibili.com",

      "--add-header",
      "User-Agent: Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/131.0.0.0 Safari/537.36",

      /*
       * Prefer best video + best audio.
       * Limit video to 1080p when possible.
       */
      "-f",
      "bestvideo[height<=1080]+bestaudio/best[height<=1080]/best",

      /*
       * FFmpeg merges/remuxes into MP4.
       */
      "--merge-output-format",
      "mp4",

      /*
       * Output file.
       */
      "-o",
      outputFile,

      url,
    ];

    const child = spawn("yt-dlp", args);

    let stderr = "";

    child.stderr.on("data", (data) => {
      stderr += data.toString();

      if (stderr.length > 15000) {
        stderr = stderr.slice(-15000);
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
              "Could not download this Bilibili video."
          )
        );
        return;
      }

      resolve();
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

  const url =
    typeof req.query?.url === "string"
      ? req.query.url.trim()
      : "";

  const title =
    typeof req.query?.title === "string"
      ? req.query.title
      : "Bilibili Video";

  if (!url) {
    return res.status(400).json({
      error: "Missing Bilibili URL.",
    });
  }

  if (!isBilibiliUrl(url)) {
    return res.status(400).json({
      error: "Invalid Bilibili URL.",
    });
  }

  const safeTitle = safeFilename(title);

  /*
   * Create a unique temporary directory.
   */
  const tempDir = await fs.promises.mkdtemp(
    path.join(os.tmpdir(), "bilisave-")
  );

  const fileId = crypto.randomBytes(8).toString("hex");

  const outputTemplate = path.join(
    tempDir,
    `${fileId}.%(ext)s`
  );

  let finalFile = null;

  try {
    console.log(
      "[BiliSave] Starting yt-dlp + FFmpeg..."
    );

    await runYtDlp(
      url,
      outputTemplate
    );

    /*
     * Find generated MP4 file.
     */
    const files =
      await fs.promises.readdir(tempDir);

    const mp4File = files.find((file) =>
      file.toLowerCase().endsWith(".mp4")
    );

    if (!mp4File) {
      throw new Error(
        "MP4 file was not created."
      );
    }

    finalFile = path.join(
      tempDir,
      mp4File
    );

    const stat =
      await fs.promises.stat(finalFile);

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
      "X-Content-Type-Options",
      "nosniff"
    );

    console.log(
      "[BiliSave] Sending MP4 to user..."
    );

    const stream =
      fs.createReadStream(finalFile);

    /*
     * If user closes download,
     * stop reading the file.
     */
    res.on("close", () => {
      stream.destroy();
    });

    stream.on("error", (error) => {
      console.error(
        "[BiliSave] File stream error:",
        error
      );

      if (!res.destroyed) {
        res.destroy(error);
      }
    });

    /*
     * Delete temporary files after
     * the response finishes.
     */
    stream.on("close", async () => {
      try {
        await fs.promises.rm(
          tempDir,
          {
            recursive: true,
            force: true,
          }
        );

        console.log(
          "[BiliSave] Temporary files deleted."
        );
      } catch (cleanupError) {
        console.error(
          "[BiliSave] Cleanup error:",
          cleanupError
        );
      }
    });

    stream.pipe(res);
  } catch (error) {
    console.error(
      "[BiliSave] Download error:",
      error
    );

    /*
     * Always cleanup on error.
     */
    try {
      await fs.promises.rm(
        tempDir,
        {
          recursive: true,
          force: true,
        }
      );
    } catch {}

    if (!res.headersSent) {
      return res.status(500).json({
        success: false,
        error:
          "Could not download this Bilibili video.",
      });
    }

    if (!res.destroyed) {
      res.destroy();
    }
  }
}
