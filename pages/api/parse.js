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

function getStreamHeaders(format, sourceUrl) {
  const original = format?.http_headers || {};
  const headers = {};

  for (const [key, value] of Object.entries(original)) {
    const lower = key.toLowerCase();

    if (
      lower === "user-agent" ||
      lower === "referer" ||
      lower === "origin" ||
      lower === "accept" ||
      lower === "accept-language"
    ) {
      headers[key] = String(value);
    }
  }

  const has = (name) =>
    Object.keys(headers).some(
      (key) => key.toLowerCase() === name.toLowerCase()
    );

  if (!has("User-Agent")) {
    headers["User-Agent"] =
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/131.0.0.0 Safari/537.36";
  }

  if (!has("Referer")) {
    headers["Referer"] = sourceUrl;
  }

  if (!has("Origin")) {
    headers["Origin"] = "https://www.bilibili.com";
  }

  if (!has("Accept")) {
    headers["Accept"] = "*/*";
  }

  return headers;
}

function runYtDlp(url) {
  return new Promise((resolve, reject) => {
    const args = [
      "--dump-single-json",
      "--skip-download",
      "--no-playlist",
      "--no-warnings",

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

    const child = spawn("yt-dlp", args, {
      stdio: ["ignore", "pipe", "pipe"],
    });

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

        const videoFormats = formats
          .filter(
            (f) =>
              f.url &&
              f.vcodec &&
              f.vcodec !== "none" &&
              (!f.acodec ||
                f.acodec === "none") &&
              (!f.height ||
                f.height <= 1080)
          )
          .sort((a, b) => {
            const height =
              (b.height || 0) -
              (a.height || 0);

            if (height) return height;

            return (
              (b.tbr || 0) -
              (a.tbr || 0)
            );
          });

        const audioFormats = formats
          .filter(
            (f) =>
              f.url &&
              f.acodec &&
              f.acodec !== "none" &&
              (!f.vcodec ||
                f.vcodec === "none")
          )
          .sort(
            (a, b) =>
              (b.abr || 0) -
              (a.abr || 0)
          );

        const combinedFormats = formats
          .filter(
            (f) =>
              f.url &&
              f.vcodec &&
              f.vcodec !== "none" &&
              f.acodec &&
              f.acodec !== "none"
          )
          .sort((a, b) => {
            const height =
              (b.height || 0) -
              (a.height || 0);

            if (height) return height;

            return (
              (b.tbr || 0) -
              (a.tbr || 0)
            );
          });

        const videoFormat =
          videoFormats[0] || null;

        const audioFormat =
          audioFormats[0] || null;

        let directUrl = null;
        let directHeaders = {};

        let videoUrl = null;
        let audioUrl = null;

        let videoHeaders = {};
        let audioHeaders = {};

        /*
         * Prefer separate streams.
         *
         * yt-dlp is used ONLY HERE.
         * It will NOT be called again by download.js.
         */
        if (videoFormat && audioFormat) {
          videoUrl = videoFormat.url;
          audioUrl = audioFormat.url;

          videoHeaders =
            getStreamHeaders(
              videoFormat,
              url
            );

          audioHeaders =
            getStreamHeaders(
              audioFormat,
              url
            );
        } else if (combinedFormats[0]) {
          directUrl =
            combinedFormats[0].url;

          directHeaders =
            getStreamHeaders(
              combinedFormats[0],
              url
            );
        } else {
          throw new Error(
            "No downloadable video streams were found."
          );
        }

        function estimateSize(format) {
          if (!format) return 0;

          const known = Number(
            format.filesize ||
              format.filesize_approx ||
              0
          );

          if (known > 0) {
            return known;
          }

          const bitrate = Number(
            format.tbr || 0
          );

          const duration = Number(
            info.duration || 0
          );

          if (
            bitrate > 0 &&
            duration > 0
          ) {
            return Math.round(
              (bitrate * 1000 / 8) *
                duration
            );
          }

          return 0;
        }

        const videoSize =
          estimateSize(videoFormat);

        const audioSize =
          estimateSize(audioFormat);

        const combinedSize =
          estimateSize(
            combinedFormats[0]
          );

        const filesize =
          videoSize && audioSize
            ? videoSize + audioSize
            : combinedSize;

        let downloadUrl =
          `/api/download?title=${encodeURIComponent(
            info.title ||
              "Bilibili Video"
          )}&sourceUrl=${encodeURIComponent(
            url
          )}`;

        if (
          videoUrl &&
          audioUrl
        ) {
          downloadUrl +=
            `&videoUrl=${encodeURIComponent(
              videoUrl
            )}`;

          downloadUrl +=
            `&audioUrl=${encodeURIComponent(
              audioUrl
            )}`;

          downloadUrl +=
            `&videoHeaders=${encodeURIComponent(
              JSON.stringify(
                videoHeaders
              )
            )}`;

          downloadUrl +=
            `&audioHeaders=${encodeURIComponent(
              JSON.stringify(
                audioHeaders
              )
            )}`;
        } else {
          downloadUrl +=
            `&directUrl=${encodeURIComponent(
              directUrl
            )}`;

          downloadUrl +=
            `&directHeaders=${encodeURIComponent(
              JSON.stringify(
                directHeaders
              )
            )}`;
        }

        resolve({
          success: true,

          mode:
            videoUrl && audioUrl
              ? "merge"
              : "direct",

          title:
            info.title ||
            "Bilibili Video",

          thumbnail:
            info.thumbnail || "",

          duration:
            Number(
              info.duration || 0
            ),

          filesize,

          videoFilesize:
            videoSize,

          audioFilesize:
            audioSize,

          directUrl,

          directHeaders,

          videoUrl,

          audioUrl,

          videoHeaders,

          audioHeaders,

          downloadUrl,
        });
      } catch (error) {
        reject(error);
      }
    });
  });
}

export default async function handler(
  req,
  res
) {
  if (
    req.method !== "POST" &&
    req.method !== "GET"
  ) {
    res.setHeader(
      "Allow",
      "POST, GET"
    );

    return res.status(405).json({
      success: false,
      error:
        "Method not allowed",
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
      success: false,
      error:
        "Please enter a Bilibili URL.",
    });
  }

  if (!isBilibiliUrl(url)) {
    return res.status(400).json({
      success: false,
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

    if (
      result.mode === "merge"
    ) {
      console.log(
        "[BiliSave] Separate streams found. FFmpeg will merge."
      );
    } else {
      console.log(
        "[BiliSave] Combined stream found. Server will proxy it."
      );
    }

    console.log(
      "[BiliSave] CDN headers captured."
    );

    return res
      .status(200)
      .json(result);
  } catch (error) {
    console.error(
      "[BiliSave] Parse error:",
      error
    );

    return res.status(500).json({
      success: false,
      error:
        error.message ||
        "Could not process this Bilibili video.",
    });
  }
}
