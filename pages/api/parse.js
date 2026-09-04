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

    const child = spawn(
      "yt-dlp",
      args
    );

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
        const info =
          JSON.parse(stdout);

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
           * Download endpoint.
           */
          downloadUrl:
            `/api/download?url=${encodeURIComponent(
              url
            )}&title=${encodeURIComponent(
              info.title ||
                "Bilibili Video"
            )}`,
        });
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
      "[BiliSave] Reading video information..."
    );

    const result =
      await runYtDlp(url);

    return res.status(200).json(
      result
    );
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
