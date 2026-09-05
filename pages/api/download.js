import fs from "fs";
import os from "os";
import path from "path";
import crypto from "crypto";
import { spawn } from "child_process";
import { Readable } from "stream";
import { pipeline } from "stream/promises";

export const config = {
  api: {
    responseLimit: false,
    bodyParser: true,
  },
};

function safeFilename(name) {
  return (
    String(
      name || "Bilibili Video"
    )
      .replace(
        /[<>:"/\\|?*\x00-\x1F]/g,
        "_"
      )
      .replace(
        /\s+/g,
        " "
      )
      .trim()
      .slice(0, 100) ||
    "Bilibili Video"
  );
}

function parseHeaders(value) {
  if (
    typeof value !== "string" ||
    !value
  ) {
    return {};
  }

  try {
    const parsed =
      JSON.parse(value);

    return parsed &&
      typeof parsed === "object"
      ? parsed
      : {};
  } catch {
    return {};
  }
}

function normaliseHeaders(
  headers,
  sourceUrl
) {
  const output = {};

  for (const [
    key,
    value,
  ] of Object.entries(
    headers || {}
  )) {
    const lower =
      key.toLowerCase();

    if (
      lower === "user-agent" ||
      lower === "referer" ||
      lower === "origin" ||
      lower === "accept" ||
      lower ===
        "accept-language"
    ) {
      output[key] =
        String(value);
    }
  }

  const has = (name) =>
    Object.keys(
      output
    ).some(
      (key) =>
        key.toLowerCase() ===
        name.toLowerCase()
    );

  if (!has("User-Agent")) {
    output["User-Agent"] =
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/131.0.0.0 Safari/537.36";
  }

  if (!has("Referer")) {
    output["Referer"] =
      sourceUrl ||
      "https://www.bilibili.com/";
  }

  if (!has("Origin")) {
    output["Origin"] =
      "https://www.bilibili.com";
  }

  if (!has("Accept")) {
    output["Accept"] = "*/*";
  }

  return output;
}

async function openUpstream(
  url,
  headers,
  label
) {
  const requestHeaders =
    normaliseHeaders(
      headers,
      headers?.Referer
    );

  /*
   * Do not request gzip/br.
   * FFmpeg receives the real media bytes.
   */
  requestHeaders[
    "Accept-Encoding"
  ] = "identity";

  const response =
    await fetch(url, {
      method: "GET",
      headers:
        requestHeaders,
      redirect: "follow",
    });

  if (
    !response.ok ||
    !response.body
  ) {
    let detail = "";

    try {
      detail =
        await response.text();
    } catch {}

    throw new Error(
      `${label} CDN request failed (${response.status} ${response.statusText})${
        detail
          ? `: ${detail.slice(
              0,
              180
            )}`
          : ""
      }`
    );
  }

  console.log(
    `[BiliSave] ${label} CDN connected: ${response.status}${
      response.headers.get(
        "content-length"
      )
        ? `, ${response.headers.get(
            "content-length"
          )} bytes`
        : ""
    }`
  );

  return response;
}

async function runFFmpegToFile(
  videoUrl,
  audioUrl,
  videoHeaders,
  audioHeaders,
  sourceUrl,
  outputFile
) {
  /*
   * Connect to Bilibili CDN first.
   */
  const videoResponse =
    await openUpstream(
      videoUrl,
      {
        ...videoHeaders,
        Referer:
          videoHeaders?.Referer ||
          sourceUrl,
      },
      "Video"
    );

  const audioResponse =
    await openUpstream(
      audioUrl,
      {
        ...audioHeaders,
        Referer:
          audioHeaders?.Referer ||
          sourceUrl,
      },
      "Audio"
    );

  const args = [
    "-hide_banner",
    "-loglevel",
    "error",

    "-i",
    "pipe:3",

    "-i",
    "pipe:4",

    "-map",
    "0:v:0",

    "-map",
    "1:a:0",

    /*
     * No re-encoding.
     */
    "-c:v",
    "copy",

    "-c:a",
    "copy",

    /*
     * Finalize MP4 metadata/index.
     */
    "-movflags",
    "+faststart",

    "-f",
    "mp4",

    outputFile,
  ];

  console.log(
    "[BiliSave] FFmpeg stream-copy started..."
  );

  const child =
    spawn(
      "ffmpeg",
      args,
      {
        stdio: [
          "ignore",
          "ignore",
          "pipe",
          "pipe",
          "pipe",
        ],
      }
    );

  let stderr = "";

  child.stderr.on(
    "data",
    (data) => {
      stderr +=
        data.toString();

      if (
        stderr.length >
        12000
      ) {
        stderr =
          stderr.slice(
            -12000
          );
      }
    }
  );

  const videoInput =
    Readable.fromWeb(
      videoResponse.body
    );

  const audioInput =
    Readable.fromWeb(
      audioResponse.body
    );

  const pumpVideo =
    pipeline(
      videoInput,
      child.stdio[3]
    );

  const pumpAudio =
    pipeline(
      audioInput,
      child.stdio[4]
    );

  const processExit =
    new Promise(
      (resolve, reject) => {
        child.on(
          "error",
          reject
        );

        child.on(
          "close",
          (
            code,
            signal
          ) => {
            resolve({
              code,
              signal,
            });
          }
        );
      }
    );

  const result =
    await processExit;

  const pumpResults =
    await Promise.allSettled(
      [
        pumpVideo,
        pumpAudio,
      ]
    );

  if (
    result.code !== 0
  ) {
    const pumpError =
      pumpResults.find(
        (x) =>
          x.status ===
          "rejected"
      )?.reason;

    throw new Error(
      stderr.trim() ||
        pumpError?.message ||
        `FFmpeg exited with code ${result.code}.`
    );
  }

  console.log(
    "[BiliSave] FFmpeg MP4 finalized successfully."
  );
}

async function downloadDirectToFile(
  url,
  headers,
  sourceUrl,
  outputFile
) {
  const response =
    await openUpstream(
      url,
      {
        ...headers,
        Referer:
          headers?.Referer ||
          sourceUrl,
      },
      "Video"
    );

  if (!response.body) {
    throw new Error(
      "CDN returned an empty video body."
    );
  }

  const temp =
    fs.createWriteStream(
      outputFile
    );

  await pipeline(
    Readable.fromWeb(
      response.body
    ),
    temp
  );
}

export default async function handler(
  req,
  res
) {
  if (
    req.method !== "GET"
  ) {
    res.setHeader(
      "Allow",
      "GET"
    );

    return res.status(405).json({
      success: false,
      error:
        "Method not allowed",
    });
  }

  const query =
    req.query || {};

  const title =
    typeof query.title ===
    "string"
      ? query.title
      : "Bilibili Video";

  const safeTitle =
    safeFilename(title);

  const sourceUrl =
    typeof query.sourceUrl ===
    "string"
      ? query.sourceUrl
      : "https://www.bilibili.com/";

  const directUrl =
    typeof query.directUrl ===
    "string"
      ? query.directUrl
      : "";

  const videoUrl =
    typeof query.videoUrl ===
    "string"
      ? query.videoUrl
      : "";

  const audioUrl =
    typeof query.audioUrl ===
    "string"
      ? query.audioUrl
      : "";

  const directHeaders =
    parseHeaders(
      query.directHeaders
    );

  const videoHeaders =
    parseHeaders(
      query.videoHeaders
    );

  const audioHeaders =
    parseHeaders(
      query.audioHeaders
    );

  if (
    !directUrl &&
    (!videoUrl ||
      !audioUrl)
  ) {
    return res.status(400).json({
      success: false,
      error:
        "Video or audio stream is missing.",
    });
  }

  let tempFile = null;

  try {
    const randomId =
      crypto
        .randomBytes(12)
        .toString("hex");

    tempFile = path.join(
      os.tmpdir(),
      `bili-${randomId}.mp4`
    );

    /*
     * CASE 1:
     * Combined stream.
     */
    if (directUrl) {
      console.log(
        "[BiliSave] Combined stream found. Downloading once through server..."
      );

      await downloadDirectToFile(
        directUrl,
        directHeaders,
        sourceUrl,
        tempFile
      );
    }

    /*
     * CASE 2:
     * Separate video + audio.
     */
    else {
      console.log(
        "[BiliSave] Separate streams detected."
      );

      await runFFmpegToFile(
        videoUrl,
        audioUrl,
        videoHeaders,
        audioHeaders,
        sourceUrl,
        tempFile
      );
    }

    /*
     * Make sure complete MP4 exists.
     */
    if (
      !fs.existsSync(
        tempFile
      )
    ) {
      throw new Error(
        "MP4 output file was not created."
      );
    }

    const stat =
      fs.statSync(
        tempFile
      );

    if (
      stat.size < 1024
    ) {
      throw new Error(
        "Generated MP4 is empty or invalid."
      );
    }

    console.log(
      `[BiliSave] Final MP4 size: ${stat.size} bytes`
    );

    /*
     * Browser download headers.
     */
    res.statusCode = 200;

    res.setHeader(
      "Content-Type",
      "video/mp4"
    );

    res.setHeader(
      "Content-Length",
      stat.size
    );

    res.setHeader(
      "Content-Disposition",
      `attachment; filename="Bilibili-Video.mp4"; filename*=UTF-8''${encodeURIComponent(
        safeTitle +
          ".mp4"
      )}`
    );

    res.setHeader(
      "Cache-Control",
      "no-store, no-cache, must-revalidate"
    );

    res.setHeader(
      "Pragma",
      "no-cache"
    );

    res.setHeader(
      "X-Content-Type-Options",
      "nosniff"
    );

    /*
     * ONLY NOW send MP4 to browser.
     */
    await pipeline(
      fs.createReadStream(
        tempFile
      ),
      res
    );

    console.log(
      "[BiliSave] MP4 sent to browser successfully."
    );
  } catch (error) {
    console.error(
      "[BiliSave] Download error:",
      error
    );

    if (
      !res.headersSent
    ) {
      return res.status(502).json({
        success: false,
        error:
          error.message ||
          "Could not create the MP4 video.",
      });
    }

    if (
      !res.destroyed
    ) {
      res.destroy();
    }
  } finally {
    /*
     * Delete temporary MP4 only
     * after browser response finishes/errors.
     */
    if (
      tempFile &&
      fs.existsSync(tempFile)
    ) {
      try {
        fs.unlinkSync(
          tempFile
        );

        console.log(
          "[BiliSave] Temporary MP4 deleted."
        );
      } catch (error) {
        console.error(
          "[BiliSave] Temporary file cleanup failed:",
          error
        );
      }
    }
  }
}
