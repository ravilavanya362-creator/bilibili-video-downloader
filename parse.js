// pages/api/parse.js
// Resolves a bilibili.com video URL into a title, cover image, and a
// direct (progressive mp4) stream URL that can be downloaded.

const BILI_HEADERS = {
  "User-Agent":
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36",
  Referer: "https://www.bilibili.com/",
};

// IPRoyal (and most residential proxy providers) assign an IP per SESSION,
// where the session is identified by a string embedded in the password
// (e.g. "<password>_country-us_session-<id>_lifetime-10m"). Two calls with
// the same session id get the SAME exit IP; two calls with different
// session ids get DIFFERENT exit IPs. We generate one random session id
// per incoming /api/parse request (shared by all Bilibili calls within
// that request, so they look like one consistent browsing session), and a
// fresh random id on retry so a single flagged IP doesn't repeat.
function randomSessionId() {
  return Math.random().toString(36).slice(2, 10);
}

function buildProxyDispatcherFactory() {
  const host = process.env.PROXY_HOST;
  const port = process.env.PROXY_PORT;
  const user = process.env.PROXY_USERNAME;
  const basePass = process.env.PROXY_PASSWORD;
  if (!host || !port) return null;

  return async function makeDispatcher(sessionId) {
    const { ProxyAgent } = await import("undici");
    const pass = basePass
      ? `${basePass}_country-us_session-${sessionId}_lifetime-10m`
      : basePass;
    const auth =
      user && pass
        ? `${encodeURIComponent(user)}:${encodeURIComponent(pass)}@`
        : "";
    const proxyUrl = `http://${auth}${host}:${port}`;
    return new ProxyAgent(proxyUrl);
  };
}

const getDispatcherForSession = buildProxyDispatcherFactory();

async function proxiedFetch(url, options = {}, sessionId) {
  if (!getDispatcherForSession) return fetch(url, options);
  const dispatcher = await getDispatcherForSession(sessionId);
  try {
    return await fetch(url, { ...options, dispatcher });
  } catch (e) {
    console.error(
      "[parse] proxiedFetch failed, retrying with a new session/IP:",
      e.message
    );
    const freshDispatcher = await getDispatcherForSession(randomSessionId());
    return fetch(url, { ...options, dispatcher: freshDispatcher });
  } finally {
    dispatcher.close?.().catch(() => {});
  }
}

function extractIds(rawUrl) {
  const bvMatch = rawUrl.match(/BV[0-9A-Za-z]{10}/);
  const avMatch = rawUrl.match(/av(\d+)/i);
  const pMatch = rawUrl.match(/[?&]p=(\d+)/);
  return {
    bvid: bvMatch ? bvMatch[0] : null,
    aid: avMatch ? avMatch[1] : null,
    page: pMatch ? parseInt(pMatch[1], 10) : 1,
  };
}

async function safeJson(res, label) {
  const text = await res.text();
  try {
    return JSON.parse(text);
  } catch (e) {
    console.error(
      `[parse] ${label} returned non-JSON (status ${res.status}):`,
      text.slice(0, 300)
    );
    throw new Error(
      `Bilibili blocked this request (${label} returned ${res.status} non-JSON). This usually happens when Bilibili's anti-bot system flags the server's IP address — common on serverless hosts. Try again later, or run this from a residential IP / with a proxy.`
    );
  }
}

async function resolveShortLink(url) {
  if (!/b23\.tv/.test(url)) return url;
  try {
    const res = await fetch(url, {
      method: "GET",
      redirect: "follow",
      headers: BILI_HEADERS,
    });
    return res.url || url;
  } catch (e) {
    console.error("[parse] resolveShortLink failed:", e.message);
    return url;
  }
}

async function getWarmupCookie(sessionId) {
  try {
    const res = await proxiedFetch(
      "https://www.bilibili.com/",
      { headers: BILI_HEADERS },
      sessionId
    );
    const setCookies =
      typeof res.headers.getSetCookie === "function"
        ? res.headers.getSetCookie()
        : res.headers.get("set-cookie")
        ? [res.headers.get("set-cookie")]
        : [];
    return setCookies
      .map((c) => c.split(";")[0])
      .filter(Boolean)
      .join("; ");
  } catch (e) {
    console.error("[parse] warm-up cookie fetch failed:", e.message);
    return "";
  }
}

export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ error: "Method not allowed" });
  }

  try {
    const { url } = req.body || {};
    if (!url || typeof url !== "string") {
      return res.status(400).json({ error: "Missing 'url' in request body" });
    }

    const finalUrl = await resolveShortLink(url.trim());
    const { bvid, aid, page } = extractIds(finalUrl);

    if (!bvid && !aid) {
      return res.status(400).json({
        error:
          "Couldn't find a BV or av video ID in that link. Paste a full bilibili.com video URL.",
      });
    }

    const sessionId = randomSessionId();

    const cookie = await getWarmupCookie(sessionId);
    const headersWithCookie = cookie
      ? { ...BILI_HEADERS, Cookie: cookie }
      : BILI_HEADERS;

    const viewQuery = bvid ? `bvid=${bvid}` : `aid=${aid}`;
    const viewRes = await proxiedFetch(
      `https://api.bilibili.com/x/web-interface/view?${viewQuery}`,
      { headers: headersWithCookie },
      sessionId
    );
    const viewJson = await safeJson(viewRes, "view API");

    if (viewJson.code !== 0) {
      return res.status(502).json({
        error: `Bilibili API error: ${viewJson.message || viewJson.code}`,
      });
    }

    const data = viewJson.data;
    const pages = data.pages || [];
    const target = pages.find((p) => p.page === page) || pages[0] || {};
    const cid = target.cid || data.cid;

    const playQuery = new URLSearchParams({
      bvid: data.bvid,
      cid: String(cid),
      qn: "64",
      platform: "html5",
      high_quality: "1",
    });

    const playRes = await proxiedFetch(
      `https://api.bilibili.com/x/player/playurl?${playQuery.toString()}`,
      { headers: headersWithCookie },
      sessionId
    );
    const playJson = await safeJson(playRes, "playurl API");

    if (playJson.code !== 0 || !playJson.data?.durl?.length) {
      return res.status(502).json({
        error:
          "Bilibili didn't return a downloadable stream for this video (it may be VIP-only, region-locked, or require login).",
      });
    }

    const durl = playJson.data.durl[0];

    return res.status(200).json({
      title: data.title,
      cover: data.pic,
      thumbnail: data.pic,
      owner: data.owner?.name,
      durationSeconds: data.duration,
      qualityLabel:
        playJson.data.accept_description?.[0] || `qn ${playJson.data.quality}`,
      streamUrl: durl.url,
      downloadUrl: `/api/download?url=${encodeURIComponent(
        durl.url
      )}&filename=${encodeURIComponent(data.title || "video")}`,
      sizeBytes: durl.size,
      bvid: data.bvid,
      cid,
    });
  } catch (err) {
    console.error(err);
    return res
      .status(500)
      .json({ error: err.message || "Unexpected server error." });
  }
}
