import { spawn } from "child_process";

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

function getVideoInfo(url) {
  return new Promise((resolve, reject) => {
    const args = [
      "--dump-single-json",
      "--skip-download",
      "--no-playlist",
      "--no-warnings",

      "--retries",
      "2",

      "--socket-timeout",
      "20",

      "--add-header",
      "Referer: https://www.bilibili.com/",

      "--add-header",
      "Origin: https://www.bilibili.com",

      "--add-header",
      "User-Agent: Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/131.0.0.0 Safari/537.36",

      url,
    ];

    const child = spawn("yt-dlp", args);

    let stdout = "";
    let stderr = "";

    child.stdout.on("data", (data) => {
      stdout += data.toString();
    });

    child.stderr.on("data", (data) => {
      stderr += data.toString();

      if (stderr.length > 12000) {
        stderr = stderr.slice(-12000);
      }
    });

    child.on("error", reject);

    child.on("close", (code) => {
      if (code !== 0) {
        reject(
          new Error(
            stderr.trim() ||
              "Could not extract this Bilibili video."
          )
        );
        return;
      }

      try {
        resolve(JSON.parse(stdout));
      } catch {
        reject(
          new Error(
            "Bilibili returned an invalid response."
          )
        );
      }
    });
  });
}

function startFFmpeg(videoUrl, audioUrl, res) {
  const commonHeaders =
    "Referer: https://www.bilibili.com/\r\n" +
    "Origin: https://www.bilibili.com\r\n" +
    "User-Agent: Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/131.0.0.0 Safari/537.36\r\n";

  const args = [
    "-hide_banner",
    "-loglevel",
    "error",

    "-headers",
    commonHeaders,

    "-i",
    videoUrl,

    "-headers",
    commonHeaders,

    "-i",
    audioUrl,

    "-map",
    "0:v:0",
    "-map",
    "1:a:0",

    "-c",
    "copy",

    "-movflags",
    "frag_keyframe+empty_moov",

    "-f",
    "mp4",

    "pipe:1",
  ];

  console.log(
    "[BiliSave] Streaming video + audio through FFmpeg..."
  );

  const ffmpeg = spawn("ffmpeg", args);

  let stderr = "";

  ffmpeg.stderr.on("data", (data) => {
    stderr += data.toString();

    if (stderr.length > 10000) {
      stderr = stderr.slice(-10000);
    }
  });

  res.on("close", () => {
    if (!ffmpeg.killed) {
      ffmpeg.kill("SIGKILL");
    }
  });

  ffmpeg.stdout.pipe(res);

  ffmpeg.on("error", (error) => {
    console.error(
      "[BiliSave] FFmpeg error:",
      error
    );

    if (!res.headersSent && !res.destroyed) {
      res.status(500).json({
        success: false,
        error: "FFmpeg could not start.",
      });
    }
  });

  ffmpeg.on("close", (code) => {
    if (code !== 0) {
      console.error(
        "[BiliSave] FFmpeg stopped:",
        stderr.slice(-3000)
      );
    } else {
      console.log(
        "[BiliSave] MP4 streaming completed."
      );
    }
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

  try {
    console.log(
      "[BiliSave] Extracting video information..."
    );

    const info = await getVideoInfo(url);

    const formats = Array.isArray(info.formats)
      ? info.formats
      : [];

    /*
     * First try a single stream that already
     * contains BOTH video and audio.
     */

    const progressiveFormats = formats
      .filter((format) => {
        const hasVideo =
          format.vcodec &&
          format.vcodec !== "none";

        const hasAudio =
          format.acodec &&
          format.acodec !== "none";

        return (
          format.url &&
          hasVideo &&
          hasAudio
        );
      })
      .sort((a, b) => {
        const heightA = Number(a.height || 0);
        const heightB = Number(b.height || 0);

        return heightB - heightA;
      });

    const directFormat =
      progressiveFormats.find(
        (format) =>
          String(format.ext).toLowerCase() ===
          "mp4"
      ) || progressiveFormats[0];

    /*
     * BEST CASE:
     *
     * Bilibili already gives us video + audio.
     * Redirect user directly to the CDN.
     */

    if (directFormat?.url) {
      console.log(
        "[BiliSave] Direct video + audio stream found."
      );

      res.setHeader(
        "Cache-Control",
        "no-store"
      );

      return res.redirect(302, directFormat.url);
    }

    /*
     * FALLBACK:
     *
     * Video and audio are separate.
     * Find best video and best audio.
     */

    const videoFormats = formats
      .filter(
        (format) =>
          format.url &&
          format.vcodec &&
          format.vcodec !== "none" &&
          (!format.height ||
            Number(format.height) <= 1080)
      )
      .sort(
        (a, b) =>
          Number(b.height || 0) -
          Number(a.height || 0)
      );

    const audioFormats = formats
      .filter(
        (format) =>
          format.url &&
          format.acodec &&
          format.acodec !== "none" &&
          (!format.vcodec ||
            format.vcodec === "none")
      )
      .sort(
        (a, b) =>
          Number(b.abr || b.tbr || 0) -
          Number(a.abr || a.tbr || 0)
      );

    const videoFormat = videoFormats[0];
    const audioFormat = audioFormats[0];

    if (!videoFormat || !audioFormat) {
      return res.status(500).json({
        success: false,
        error:
          "No compatible video and audio streams were found.",
      });
    }

    console.log(
      "[BiliSave] Separate streams detected. FFmpeg streaming fallback."
    );

    const filename =
      safeFilename(title) + ".mp4";

    res.statusCode = 200;

    res.setHeader(
      "Content-Type",
      "video/mp4"
    );

    res.setHeader(
      "Content-Disposition",
      `attachment; filename="Bilibili-Video.mp4"; filename*=UTF-8''${encodeURIComponent(
        filename
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

    startFFmpeg(
      videoFormat.url,
      audioFormat.url,
      res
    );
  } catch (error) {
    console.error(
      "[BiliSave] Download error:",
      error
    );

    if (!res.headersSent && !res.destroyed) {
      return res.status(500).json({
        success: false,
        error:
          "Could not download this Bilibili video.",
      });
    }
  }
}
