import { spawn } from "child_process";

export const config = {
  api: {
    responseLimit: false,
    bodyParser: true,
  },
};

function safeFilename(name) {
  return (
    String(name || "Bilibili Video")
      .replace(/[<>:"/\\|?*\x00-\x1F]/g, "_")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, 100) || "Bilibili Video"
  );
}

/*
 * Headers required by Bilibili CDN.
 */
const BILIBILI_HEADERS =
  "Referer: https://www.bilibili.com/\r\n" +
  "Origin: https://www.bilibili.com\r\n" +
  "User-Agent: Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36\r\n";

/*
 * Run FFmpeg without re-encoding.
 *
 * Video/audio are copied directly.
 * This is much faster than encoding.
 */
function runFFmpeg(inputs, res) {
  return new Promise((resolve, reject) => {
    const args = [
      "-hide_banner",
      "-loglevel",
      "error",

      /*
       * HTTP headers for Bilibili CDN.
       */
      "-headers",
      BILIBILI_HEADERS,

      /*
       * Input #1
       */
      "-i",
      inputs[0],

      /*
       * If there is a second input,
       * it is the separate audio stream.
       */
    ];

    /*
     * Separate video + audio.
     */
    if (inputs.length === 2) {
      args.push(
        "-headers",
        BILIBILI_HEADERS,

        "-i",
        inputs[1],

        "-map",
        "0:v:0",

        "-map",
        "1:a:0"
      );
    }

    /*
     * Stream-copy.
     * NO video/audio re-encoding.
     */
    args.push(
      "-c:v",
      "copy",

      "-c:a",
      "copy",

      /*
       * MP4 that can be streamed while being created.
       */
      "-movflags",
      "frag_keyframe+empty_moov+default_base_moof",

      "-f",
      "mp4",

      "pipe:1"
    );

    console.log(
      "[BiliSave] FFmpeg stream-copy started..."
    );

    const child = spawn(
      "ffmpeg",
      args,
      {
        stdio: [
          "ignore",
          "pipe",
          "pipe",
        ],
      }
    );

    let stderr = "";

    child.stderr.on("data", (data) => {
      stderr += data.toString();

      if (stderr.length > 15000) {
        stderr = stderr.slice(-15000);
      }
    });

    child.stdout.on("error", (error) => {
      reject(error);
    });

    child.stderr.on("error", (error) => {
      console.error(
        "[BiliSave] FFmpeg stderr error:",
        error
      );
    });

    child.on("error", (error) => {
      reject(error);
    });

    /*
     * Send MP4 directly to browser.
     */
    child.stdout.pipe(res);

    child.on("close", (code) => {
      if (code !== 0) {
        console.error(
          "[BiliSave] FFmpeg process failed:",
          stderr
        );

        reject(
          new Error(
            stderr.trim() ||
              "FFmpeg could not create the MP4."
          )
        );

        return;
      }

      console.log(
        "[BiliSave] FFmpeg stream-copy completed."
      );

      resolve();
    });

    /*
     * If browser closes download,
     * stop FFmpeg immediately.
     */
    res.on("close", () => {
      if (!child.killed) {
        console.log(
          "[BiliSave] Browser connection closed. Stopping FFmpeg..."
        );

        child.kill("SIGTERM");
      }
    });
  });
}

export default async function handler(req, res) {
  if (req.method !== "GET") {
    res.setHeader(
      "Allow",
      "GET"
    );

    return res.status(405).json({
      error: "Method not allowed",
    });
  }

  /*
   * Combined video + audio URL.
   */
  const directUrl =
    typeof req.query?.directUrl === "string"
      ? req.query.directUrl.trim()
      : "";

  /*
   * Separate video URL.
   */
  const videoUrl =
    typeof req.query?.videoUrl === "string"
      ? req.query.videoUrl.trim()
      : "";

  /*
   * Separate audio URL.
   */
  const audioUrl =
    typeof req.query?.audioUrl === "string"
      ? req.query.audioUrl.trim()
      : "";

  /*
   * Video title.
   */
  const title =
    typeof req.query?.title === "string"
      ? req.query.title
      : "Bilibili Video";

  const safeTitle =
    safeFilename(title);

  /*
   * ==================================================
   * CASE 1
   * Combined video + audio
   *
   * IMPORTANT:
   * Do NOT redirect directly to CDN.
   *
   * Browser redirect was causing 403.
   *
   * Instead FFmpeg requests the CDN with
   * Bilibili headers and stream-copies the file.
   * ==================================================
   */

  if (directUrl) {
    console.log(
      "[BiliSave] Combined stream detected."
    );

    console.log(
      "[BiliSave] Starting FFmpeg stream-copy for combined stream..."
    );

    res.statusCode = 200;

    res.setHeader(
      "Content-Type",
      "video/mp4"
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

    try {
      await runFFmpeg(
        [directUrl],
        res
      );

      console.log(
        "[BiliSave] MP4 stream completed."
      );

    } catch (error) {
      console.error(
        "[BiliSave] FFmpeg combined-stream error:",
        error
      );

      if (!res.destroyed) {
        res.destroy();
      }
    }

    return;
  }

  /*
   * ==================================================
   * CASE 2
   * Separate video + audio
   *
   * FFmpeg combines them.
   *
   * NO yt-dlp here.
   * ==================================================
   */

  if (!videoUrl || !audioUrl) {
    return res.status(400).json({
      success: false,
      error:
        "Video or audio stream is missing.",
    });
  }

  try {
    console.log(
      "[BiliSave] Separate streams detected."
    );

    console.log(
      "[BiliSave] Starting FFmpeg stream-copy..."
    );

    res.statusCode = 200;

    res.setHeader(
      "Content-Type",
      "video/mp4"
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

    await runFFmpeg(
      [
        videoUrl,
        audioUrl,
      ],
      res
    );

    console.log(
      "[BiliSave] MP4 stream completed."
    );

  } catch (error) {
    console.error(
      "[BiliSave] FFmpeg error:",
      error
    );

    if (!res.destroyed) {
      res.destroy();
    }
  }
}
