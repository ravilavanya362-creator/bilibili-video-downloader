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
  return (
    String(name || "Bilibili Video")
      .replace(/[<>:"/\\|?*\x00-\x1F]/g, "_")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, 80) || "Bilibili Video"
  );
}

function cleanup(dir, id) {
  try {
    for (const file of fs.readdirSync(dir)) {
      if (file.startsWith(id + ".")) {
        try {
          fs.unlinkSync(path.join(dir, file));
        } catch {}
      }
    }
  } catch {}
}

function isBilibiliUrl(value) {
  try {
    const u = new URL(value);
    const host = u.hostname.toLowerCase();
    return (
      host === "b23.tv" ||
      host === "www.b23.tv" ||
      host === "bilibili.com" ||
      host.endsWith(".bilibili.com")
    );
  } catch {
    return false;
  }
}

export default function handler(req, res) {
  if (req.method !== "GET") {
    res.setHeader("Allow", "GET");
    return res.status(405).json({ error: "Method not allowed" });
  }

  const url = typeof req.query?.url === "string" ? req.query.url.trim() : "";
  const title = typeof req.query?.title === "string" ? req.query.title : "Bilibili Video";

  if (!url) {
    return res.status(400).json({ error: "Missing Bilibili URL." });
  }

  if (!isBilibiliUrl(url)) {
    return res.status(400).json({ error: "Invalid Bilibili URL." });
  }

  const id = crypto.randomBytes(8).toString("hex");
  const tempDir = os.tmpdir();
  const output = path.join(tempDir, `${id}.%(ext)s`);
  const filename = safeFilename(title);

  const args = [
    "--no-warnings",
    "--no-playlist",

    // Speed: download independent fragments concurrently.
    "-N",
    "8",

    // Retry only when needed.
    "--retries",
    "5",
    "--fragment-retries",
    "5",
    "--socket-timeout",
    "30",

    // Bilibili request headers.
    "--add-header",
    "Referer: https://www.bilibili.com/",
    "--add-header",
    "Origin: https://www.bilibili.com",
    "--add-header",
    "User-Agent: Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/131.0.0.0 Safari/537.36",

    // Best available video + audio; fall back to a single stream.
    "-f",
    "bv*+ba/b",

    // FFmpeg creates a normal MP4 when separate video/audio are selected.
    "--merge-output-format",
    "mp4",

    "-o",
    output,
    url,
  ];

  console.log("BiliSave download started:", url);

  const child = spawn("yt-dlp", args);
  let stderr = "";

  child.stdout.on("data", (data) => {
    console.log("[yt-dlp]", data.toString().trim());
  });

  child.stderr.on("data", (data) => {
    const text = data.toString();
    stderr += text;
    if (stderr.length > 12000) stderr = stderr.slice(-12000);
    console.log("[yt-dlp]", text.trim());
  });

  child.on("error", (error) => {
    console.error("yt-dlp start error:", error);
    cleanup(tempDir, id);

    if (!res.headersSent) {
      res.status(500).json({
        error: "Downloader could not start.",
        details: error.message,
      });
    }
  });

  child.on("close", (code) => {
    if (code !== 0) {
      console.error("yt-dlp failed:", stderr);
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
      const matches = fs
        .readdirSync(tempDir)
        .filter((file) => file.startsWith(id + "."));

      downloadedFile =
        matches.find((file) => file.endsWith(".mp4")) ||
        matches.find((file) => !file.endsWith(".part")) ||
        null;
    } catch (error) {
      console.error("Temp directory error:", error);
    }

    if (!downloadedFile) {
      cleanup(tempDir, id);
      return res.status(500).json({
        error: "Downloaded video file was not found.",
      });
    }

    const filePath = path.join(tempDir, downloadedFile);

    let stat;
    try {
      stat = fs.statSync(filePath);
    } catch {
      cleanup(tempDir, id);
      return res.status(500).json({
        error: "Unable to read downloaded video.",
      });
    }

    // IMPORTANT: keep this header ASCII-only.
    // This avoids ERR_INVALID_CHAR with Chinese Bilibili titles.
    res.statusCode = 200;
    res.setHeader("Content-Type", "video/mp4");
    res.setHeader(
      "Content-Disposition",
      `attachment; filename="Bilibili-Video-${id}.mp4"`
    );
    res.setHeader("Content-Length", stat.size);
    res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate");
    res.setHeader("Accept-Ranges", "bytes");

    console.log("Sending MP4:", filePath, stat.size, "bytes");

    const stream = fs.createReadStream(filePath);

    stream.on("error", (error) => {
      console.error("File streaming error:", error);
      cleanup(tempDir, id);
      if (!res.destroyed) res.destroy(error);
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
