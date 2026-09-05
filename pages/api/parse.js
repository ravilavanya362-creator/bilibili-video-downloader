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

/*
 * Convert yt-dlp headers into a small JSON object.
 *
 * These headers are needed because Bilibili CDN can reject
 * direct requests with 403 Forbidden.
 */
function getStreamHeaders(format) {
  const headers = format?.http_headers || {};

  const allowed = {};

  for (const [key, value] of Object.entries(headers)) {
    const lower = key.toLowerCase();

    if (
      lower === "user-agent" ||
      lower === "referer" ||
      lower === "origin"
    ) {
      allowed[key] = String(value);
    }
  }

  /*
   * Fallback headers if yt-dlp does not provide them.
   */
  if (!allowed["User-Agent"]) {
    allowed["User-Agent"] =
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/131.0.0.0 Safari/537.36";
  }

  if (!allowed["Referer"]) {
    allowed["Referer"] =
      "https://www.bilibili.com/";
  }

  if (!allowed["Origin"]) {
    allowed["Origin"] =
      "https://www.bilibili.com";
  }

  return allowed;
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

        /*
         * ==========================================
         * COMBINED FORMAT
         * ==========================================
         */
        const combinedFormat = (info.formats || [])
          .filter(
            (f) =>
              f.url &&
              f.vcodec &&
              f.vcodec !== "none" &&
              f.acodec &&
              f.acodec !== "none"
          )
          .sort(
            (a, b) =>
              (b.height || 0) -
              (a.height || 0)
          )[0];

        /*
         * ==========================================
         * VIDEO-ONLY FORMAT
         * ==========================================
         */
        const videoFormat = (info.formats || [])
          .filter(
            (f) =>
              f.url &&
              f.vcodec &&
              f.vcodec !== "none" &&
              (!f.acodec ||
                f.acodec === "none") &&
              (f.height || 0) <= 1080
          )
          .sort(
            (a, b) =>
              (b.height || 0) -
              (a.height || 0)
          )[0];

        /*
         * ==========================================
         * AUDIO-ONLY FORMAT
         * ==========================================
         */
        const audioFormat = (info.formats || [])
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
          )[0];

        let directUrl = null;
        let videoUrl = null;
        let audioUrl = null;

        let directHeaders = {};
        let videoHeaders = {};
        let audioHeaders = {};

        /*
         * Combined stream.
         */
        if (combinedFormat) {
          directUrl = combinedFormat.url;

          directHeaders =
            getStreamHeaders(
              combinedFormat
            );
        } else {
          /*
           * Separate streams.
           */
          videoUrl =
            videoFormat?.url || null;

          audioUrl =
            audioFormat?.url || null;

          if (videoFormat) {
            videoHeaders =
              getStreamHeaders(
                videoFormat
              );
          }

          if (audioFormat) {
            audioHeaders =
              getStreamHeaders(
                audioFormat
              );
          }
        }

        if (
          !directUrl &&
          (!videoUrl || !audioUrl)
        ) {
          throw new Error(
            "No downloadable video streams were found."
          );
        }

        /*
         * ==========================================
         * DOWNLOAD URL
         * ==========================================
         *
         * IMPORTANT:
         * Headers are now passed to download.js.
         *
         * yt-dlp is NOT executed again.
         */
        let downloadUrl =
          `/api/download?title=${encodeURIComponent(
            info.title ||
              "Bilibili Video"
          )}`;

        if (directUrl) {
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
        } else {
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
        }

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

          directUrl,

          videoUrl,

          audioUrl,

          videoHeaders,

          audioHeaders,

          directHeaders,

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

    if (result.directUrl) {
      console.log(
        "[BiliSave] Combined stream found."
      );
    } else {
      console.log(
        "[BiliSave] Separate streams found. FFmpeg will merge."
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
        "Could not process this Bilibili video.",
    });
  }
}
