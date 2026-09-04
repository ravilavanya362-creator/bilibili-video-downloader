import { spawn } from "child_process";
import fs from "fs";
import os from "os";
import path from "path";
import crypto from "crypto";

export const config = {
  api: {
    responseLimit: false,
  },
};

function safeFilename(name) {
  return String(name || "Bilibili Video")
    .replace(/[<>:"/\\|?*\x00-\x1F]/g, "_")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 100) || "Bilibili Video";
}

function cleanup(dir, id) {
  try {
    const files = fs.readdirSync(dir);

    for (const file of files) {
      if (file.startsWith(id + ".")) {
        try {
          fs.unlinkSync(path.join(dir, file));
        } catch {}
      }
    }
  } catch {}
}

export default function handler(req, res) {
  if (req.method !== "GET") {
    res.setHeader("Allow", "GET");
    return res.status(405).json({
      error: "Method not allowed",
    });
  }

  const { url, title } = req.query;

  if (!url || typeof url !== "string") {
    return res.status(400).json({
      error: "Missing Bilibili URL",
    });
  }

  const id = crypto.randomBytes(8).toString("hex");
  const tempDir = os.tmpdir();
  const output = path.join(tempDir, `${id}.%(ext)s`);

  const filename = safeFilename(title);

  const args = [
    "--no-warnings",
    "--no-playlist",

    // Reliability
    "--retries", "10",
    "--fragment-retries", "10",
    "--retry-sleep", "2",

    // Bilibili request headers
    "--add-header",
    "Referer: https://www.bilibili.com/",

    "--add-header",
    "Origin: https://www.bilibili.com",

    "--add-header",
    "User-Agent: Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/131.0.0.0 Safari/537.36",

    // Best available MP4
    "-f",
    "bv*[ext=mp4]+ba[ext=m4a]/bv*+ba/b[ext=mp4]/b",

    // Merge into MP4
    "--merge-output-format",
    "mp4",

    "-o",
    output,

    url,
  ];

  console.log("BiliSave download:", url);

  const process = spawn("yt-dlp", args);

  let stderr = "";
  let stdout = "";

  process.stdout.on("data", (data) => {
    const text = data.toString();
    stdout += text;
    console.log("[yt-dlp]", text.trim());
  });

  process.stderr.on("data", (data) => {
    const text = data.toString();

    stderr += text;

    if (stderr.length > 10000) {
      stderr = stderr.slice(-10000);
    }

    console.log("[yt-dlp]", text.trim());
  });

  process.on("error", (error) => {
    console.error("yt-dlp error:", error);

    cleanup(tempDir, id);

    if (!res.headersSent) {
      res.status(500).json({
        error: "Downloader could not start.",
        details: error.message,
      });
    }
  });

  process.on("close", (code) => {
    if (code !== 0) {
      console.error("yt-dlp failed:");
      console.error(stderr);

      cleanup(tempDir, id);

      if (!res.headersSent) {
        res.status(500).json({
          error: "Bilibili download failed.",
          details: stderr.slice(-1500),
        });
      }

      return;
    }

    let downloadedFile = null;

    try {
      const files = fs.readdirSync(tempDir);

      const matches = files.filter((file) =>
        file.startsWith(id + ".")
      );

      // Prefer MP4
      downloadedFile =
        matches.find((file) => file.endsWith(".mp4")) ||
        matches[0];
    } catch (error) {
      console.error("Temp file error:", error);
    }

    if (!downloadedFile) {
      cleanup(tempDir, id);

      return res.status(500).json({
        error: "Downloaded file was not found.",
        details: stderr.slice(-1500),
      });
    }

    const filePath = path.join(tempDir, downloadedFile);

    if (!fs.existsSync(filePath)) {
      cleanup(tempDir, id);

      return res.status(500).json({
        error: "Downloaded file does not exist.",
      });
    }

    let stat;

    try {
      stat = fs.statSync(filePath);
    } catch {
      cleanup(tempDir, id);

      return res.status(500).json({
        error: "Unable to read downloaded file.",
      });
    }

    console.log(
      "Download ready:",
      filePath,
      "Size:",
      stat.size
    );

    res.statusCode = 200;

    res.setHeader(
      "Content-Type",
      "video/mp4"
    );

    res.setHeader(
      "Content-Disposition",
      `attachment; filename="${filename}.mp4"`
    );

    res.setHeader(
      "Content-Length",
      stat.size
    );

    res.setHeader(
      "Cache-Control",
      "no-store"
    );

    const stream = fs.createReadStream(filePath);

    stream.on("error", (error) => {
      console.error("File stream error:", error);

      cleanup(tempDir, id);

      if (!res.destroyed) {
        res.destroy(error);
      }
    });

    stream.on("end", () => {
      console.log("Download sent successfully.");

      cleanup(tempDir, id);
    });

    res.on("close", () => {
      cleanup(tempDir, id);
    });

    stream.pipe(res);
  });
}
