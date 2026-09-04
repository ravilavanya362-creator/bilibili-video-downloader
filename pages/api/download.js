import { spawn } from "child_process";
import fs from "fs";
import os from "os";
import path from "path";
import crypto from "crypto";

export const config = {
  api: {
    responseLimit: false,
    externalResolver: true,
  },
};

export default function handler(req, res) {
  if (req.method !== "GET") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  const { url, title } = req.query;

  if (!url || typeof url !== "string") {
    return res.status(400).json({
      error: "Missing Bilibili URL",
    });
  }

  const id = crypto.randomBytes(8).toString("hex");
  const tempDir = os.tmpdir();

  // yt-dlp will create:
  // id.mp4 / id.webm / id.mkv etc.
  const outputTemplate = path.join(tempDir, `${id}.%(ext)s`);

  const safeTitle =
    String(title || "Bilibili Video")
      .replace(/[<>:"/\\|?*\x00-\x1F]/g, "_")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, 120) || "Bilibili Video";

  const args = [
    "--no-warnings",
    "--no-playlist",

    // Better reliability
    "--retries", "10",
    "--fragment-retries", "10",
    "--retry-sleep", "2",

    // Bilibili needs HTTPS
    "--force-ipv4",

    // Best video + audio, fallback to single file
    "-f", "bv*+ba/b",

    // Always try to create MP4
    "--merge-output-format", "mp4",

    // Output
    "-o", outputTemplate,

    url,
  ];

  console.log("Starting yt-dlp:", url);

  const ytdlp = spawn("yt-dlp", args);

  let stderr = "";
  let finished = false;

  ytdlp.stderr.on("data", (data) => {
    const text = data.toString();
    stderr += text;

    // Keep Render logs useful without flooding them
    console.log("[yt-dlp]", text.trim());
  });

  ytdlp.stdout.on("data", (data) => {
    console.log("[yt-dlp]", data.toString().trim());
  });

  ytdlp.on("error", (error) => {
    console.error("yt-dlp start error:", error);

    if (!res.headersSent) {
      res.status(500).json({
        error: "Could not start downloader.",
        details: error.message,
      });
    }
  });

  ytdlp.on("close", (code) => {
    if (finished) return;
    finished = true;

    if (code !== 0) {
      console.error("yt-dlp failed:", stderr);

      if (!res.headersSent) {
        res.status(500).json({
          error: "Bilibili download failed.",
          details: stderr.slice(-1000),
        });
      }

      cleanupFiles(tempDir, id);
      return;
    }

    /*
     * Do NOT assume the output is always id.mp4.
     * Find the actual file created by yt-dlp.
     */
    let files = [];

    try {
      files = fs
        .readdirSync(tempDir)
        .filter((file) => file.startsWith(`${id}.`));
    } catch (error) {
      console.error("Could not read temp directory:", error);
    }

    if (!files.length) {
      console.error("No downloaded file found.");

      if (!res.headersSent) {
        res.status(500).json({
          error: "Downloaded video file was not created.",
          details: stderr.slice(-1000),
        });
      }

      return;
    }

    // Prefer MP4
    const mp4 = files.find((file) => file.endsWith(".mp4"));
    const selectedFile = mp4 || files[0];

    const filePath = path.join(tempDir, selectedFile);

    if (!fs.existsSync(filePath)) {
      return res.status(500).json({
        error: "Downloaded file does not exist.",
      });
    }

    let stat;

    try {
      stat = fs.statSync(filePath);
    } catch (error) {
      return res.status(500).json({
        error: "Could not read downloaded file.",
      });
    }

    const extension = path.extname(filePath).toLowerCase();

    const contentType =
      extension === ".mp4"
        ? "video/mp4"
        : extension === ".webm"
        ? "video/webm"
        : "application/octet-stream";

    res.statusCode = 200;

    res.setHeader("Content-Type", contentType);
    res.setHeader(
      "Content-Disposition",
      `attachment; filename="${safeTitle}.mp4"`
    );
    res.setHeader("Content-Length", stat.size);
    res.setHeader("Cache-Control", "no-store");
    res.setHeader("Accept-Ranges", "bytes");

    console.log("Sending file:", filePath);
    console.log("File size:", stat.size);

    const stream = fs.createReadStream(filePath);

    stream.on("error", (error) => {
      console.error("File stream error:", error);

      cleanupFiles(tempDir, id);

      if (!res.headersSent) {
        res.status(500).json({
          error: "Could not send video.",
        });
      } else {
        res.destroy();
      }
    });

    stream.on("close", () => {
      cleanupFiles(tempDir, id);
      console.log("Temporary files cleaned:", id);
    });

    res.on("close", () => {
      if (!res.writableEnded) {
        stream.destroy();
        cleanupFiles(tempDir, id);
      }
    });

    stream.pipe(res);
  });
}

function cleanupFiles(dir, id) {
  try {
    const files = fs
      .readdirSync(dir)
      .filter((file) => file.startsWith(`${id}.`));

    for (const file of files) {
      try {
        fs.unlinkSync(path.join(dir, file));
      } catch (error) {
        console.error("Cleanup error:", error.message);
      }
    }
  } catch (error) {
    console.error("Cleanup directory error:", error.message);
  }
}
