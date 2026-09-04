import { spawn } from "child_process";

export const config = {
  api: {
    bodyParser: true,
    responseLimit: false,
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

function runYtDlp(url) {
  return new Promise((resolve, reject) => {
    const args = [
      "--dump-single-json",
      "--skip-download",
      "--no-playlist",
      "--no-warnings",

      "--retries",
      "3",

      "--fragment-retries",
      "3",

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

      if (stderr.length > 10000) {
        stderr = stderr.slice(-10000);
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
              "Could not extract this Bilibili video."
          )
        );
        return;
      }

      try {
        const info = JSON.parse(stdout);

        const formats = Array.isArray(info.formats)
          ? info.formats
          : [];

        /*
         * IMPORTANT:
         *
         * Find ONE format that already contains:
         *
         * VIDEO + AUDIO
         *
         * This means:
         *
         * No FFmpeg
         * No server-side download
         * No merge
         *
         * Direct download.
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
            const heightA =
              Number(a.height || 0);

            const heightB =
              Number(b.height || 0);

            /*
             * Prefer highest available quality
             * up to 1080p.
             */

            const limitedA =
              heightA > 1080 ? 0 : heightA;

            const limitedB =
              heightB > 1080 ? 0 : heightB;

            if (limitedB !== limitedA) {
              return limitedB - limitedA;
            }

            return (
              Number(b.tbr || 0) -
              Number(a.tbr || 0)
            );
          });

        /*
         * Prefer MP4 progressive stream.
         */

        const mp4Format =
          progressiveFormats.find(
            (format) =>
              String(format.ext).toLowerCase() ===
              "mp4"
          );

        const directFormat =
          mp4Format ||
          progressiveFormats[0] ||
          null;

        if (!directFormat) {
          return resolve({
            success: false,

            title:
              info.title ||
              "Bilibili Video",

            thumbnail:
              info.thumbnail ||
              "",

            duration:
              info.duration || 0,

            directUrl: null,

            error:
              "This video does not provide a direct video + audio stream.",
          });
        }

        console.log(
          "[BiliSave] Direct format:",
          directFormat.format_id,
          directFormat.ext,
          directFormat.height
        );

        resolve({
          success: true,

          title:
            info.title ||
            "Bilibili Video",

          thumbnail:
            info.thumbnail ||
            "",

          duration:
            info.duration || 0,

          /*
           * This is the actual Bilibili CDN URL.
           */
          directUrl:
            directFormat.url,

          format:
            directFormat.format_id ||
            "",

          quality:
            directFormat.height
              ? `${directFormat.height}p`
              : "HD",

          ext:
            directFormat.ext ||
            "mp4",
        });
      } catch (error) {
        reject(
          new Error(
            "Bilibili returned an invalid response."
          )
        );
      }
    });
  });
}

export default async function handler(req, res) {
  if (
    req.method !== "POST" &&
    req.method !== "GET"
  ) {
    res.setHeader(
      "Allow",
      "POST, GET"
    );

    return res.status(405).json({
      error: "Method not allowed",
    });
  }

  const url =
    req.method === "POST"
      ? String(req.body?.url || "").trim()
      : String(req.query?.url || "").trim();

  if (!url) {
    return res.status(400).json({
      error:
        "Please enter a Bilibili URL.",
    });
  }

  if (!isBilibiliUrl(url)) {
    return res.status(400).json({
      error:
        "Please enter a valid Bilibili or b23.tv URL.",
    });
  }

  try {
    console.log(
      "[BiliSave] Extracting direct stream..."
    );

    const result =
      await runYtDlp(url);

    return res.status(200).json(result);
  } catch (error) {
    console.error(
      "[BiliSave] Parse error:",
      error
    );

    return res.status(500).json({
      success: false,

      error:
        "Could not process this Bilibili video.",

      details:
        String(
          error.message || error
        ).slice(-1000),
    });
  }
}
