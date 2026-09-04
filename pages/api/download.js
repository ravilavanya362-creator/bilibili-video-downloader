import { Readable } from "stream";

export const config = {
  api: {
    responseLimit: false,
    bodyParser: false,
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
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, 100) ||
    "Bilibili Video"
  );
}

function isAllowedMediaUrl(value) {
  try {
    const u = new URL(value);

    if (u.protocol !== "https:") {
      return false;
    }

    const host =
      u.hostname.toLowerCase();

    /*
     * Bilibili CDN domains.
     */

    return (
      host.endsWith(
        ".bilivideo.com"
      ) ||
      host.endsWith(
        ".bilivideo.cn"
      ) ||
      host.endsWith(
        ".hdslb.com"
      ) ||
      host.endsWith(
        ".akamaized.net"
      )
    );
  } catch {
    return false;
  }
}

export default async function handler(
  req,
  res
) {
  if (req.method !== "GET") {
    res.setHeader(
      "Allow",
      "GET"
    );

    return res.status(405).json({
      error:
        "Method not allowed",
    });
  }

  const mediaUrl =
    typeof req.query?.url === "string"
      ? req.query.url.trim()
      : "";

  const title =
    typeof req.query?.title === "string"
      ? req.query.title
      : "Bilibili Video";

  if (!mediaUrl) {
    return res.status(400).json({
      error:
        "Missing video stream URL.",
    });
  }

  if (
    !isAllowedMediaUrl(mediaUrl)
  ) {
    return res.status(400).json({
      error:
        "Invalid Bilibili media URL.",
    });
  }

  const filename =
    safeFilename(title);

  try {
    console.log(
      "[BiliSave] Starting DIRECT CDN stream..."
    );

    /*
     * IMPORTANT:
     *
     * No yt-dlp here.
     * No FFmpeg here.
     * No temporary file here.
     *
     * Bilibili CDN → Render → User
     */

    const headers = {
      Referer:
        "https://www.bilibili.com/",

      Origin:
        "https://www.bilibili.com",

      "User-Agent":
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/131.0.0.0 Safari/537.36",
    };

    /*
     * Forward Range requests.
     * Useful for large files.
     */

    if (req.headers.range) {
      headers.Range =
        req.headers.range;
    }

    const upstream =
      await fetch(mediaUrl, {
        method: "GET",
        headers,
        redirect: "follow",
      });

    if (!upstream.ok) {
      console.error(
        "[BiliSave] CDN status:",
        upstream.status
      );

      return res.status(502).json({
        error:
          "Bilibili stream expired. Please press Download again.",
      });
    }

    /*
     * Preserve 200 / 206 status.
     */

    res.statusCode =
      upstream.status;

    const contentType =
      upstream.headers.get(
        "content-type"
      ) || "video/mp4";

    const contentLength =
      upstream.headers.get(
        "content-length"
      );

    const contentRange =
      upstream.headers.get(
        "content-range"
      );

    res.setHeader(
      "Content-Type",
      contentType.includes("video")
        ? contentType
        : "video/mp4"
    );

    /*
     * ASCII fallback prevents:
     *
     * ERR_INVALID_CHAR
     *
     * for Chinese titles.
     */

    res.setHeader(
      "Content-Disposition",
      `attachment; filename="Bilibili-Video.mp4"; filename*=UTF-8''${encodeURIComponent(
        filename + ".mp4"
      )}`
    );

    res.setHeader(
      "Cache-Control",
      "no-store"
    );

    res.setHeader(
      "X-Content-Type-Options",
      "nosniff"
    );

    if (contentLength) {
      res.setHeader(
        "Content-Length",
        contentLength
      );
    }

    if (contentRange) {
      res.setHeader(
        "Content-Range",
        contentRange
      );
    }

    res.setHeader(
      "Accept-Ranges",
      "bytes"
    );

    if (!upstream.body) {
      return res.end();
    }

    /*
     * DIRECT STREAM
     *
     * Nothing is saved to Render disk.
     */

    const stream =
      Readable.fromWeb(
        upstream.body
      );

    stream.on(
      "error",
      (error) => {
        console.error(
          "[BiliSave] Stream error:",
          error
        );

        if (!res.destroyed) {
          res.destroy(error);
        }
      }
    );

    res.on(
      "close",
      () => {
        stream.destroy();
      }
    );

    stream.pipe(res);
  } catch (error) {
    console.error(
      "[BiliSave] Download error:",
      error
    );

    if (!res.headersSent) {
      return res.status(502).json({
        error:
          "Unable to start Bilibili download.",
      });
    }

    if (!res.destroyed) {
      res.destroy(error);
    }
  }
}
