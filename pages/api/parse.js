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
      "--no-check-certificates",

      "--retries",
      "2",

      "--socket-timeout",
      "15",

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
              "Could not process this Bilibili video."
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
         * Find a single stream containing BOTH
         * video and audio.
         */
        const combinedFormats = formats
          .filter((format) => {
            const hasVideo =
              format.vcodec &&
              format.vcodec !== "none";

            const hasAudio =
              format.acodec &&
              format.acodec !== "none";

            const height =
              Number(format.height || 0);

            return (
              format.url &&
              hasVideo &&
              hasAudio &&
              height <= 1080
            );
          })
          .sort((a, b) => {
            const heightA =
              Number(a.height || 0);

            const heightB =
              Number(b.height || 0);

            if (heightA !== heightB) {
              return heightB - heightA;
            }

            return (
              Number(b.tbr || 0) -
              Number(a.tbr || 0)
            );
          });

        const directFormat =
          combinedFormats.find(
            (format) =>
              String(format.ext).toLowerCase() === "mp4"
          ) ||
          combinedFormats[0] ||
          null;

        /*
         * DIRECT MODE
         *
         * Video + audio already together.
         */
        if (directFormat) {
          console.log(
            "[BiliSave] Combined stream found:",
            directFormat.format_id
          );

          return resolve({
            success: true,
            mode: "direct",

            title:
              info.title ||
              "Bilibili Video",

            thumbnail:
              info.thumbnail ||
              "",

            duration:
              info.duration || 0,

            quality:
              directFormat.height
                ? `${directFormat.height}p`
                : "HD",

            ext:
              directFormat.ext ||
              "mp4",

            directUrl:
              directFormat.url,
          });
        }

        /*
         * FALLBACK MODE
         *
         * Video/audio are separate.
         * /api/download will use yt-dlp + FFmpeg.
         */
        console.log(
          "[BiliSave] Separate streams detected. FFmpeg fallback."
        );

        resolve({
          success: true,
          mode: "merge",

          title:
            info.title ||
            "Bilibili Video",

          thumbnail:
            info.thumbnail ||
            "",

          duration:
            info.duration || 0,

          quality: "HD",

          downloadUrl:
            `/api/download?url=${encodeURIComponent(
              url
            )}&title=${encodeURIComponent(
              info.title ||
                "Bilibili Video"
            )}`,
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
      ? String(
          req.body?.url || ""
        ).trim()
      : String(
          req.query?.url || ""
        ).trim();

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
      "[BiliSave] Extracting video information..."
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
