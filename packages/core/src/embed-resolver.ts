/**
 * Embed stream resolvers.
 *
 * livetv.sx lists "Browser Links" as iframe embed pages from a handful of
 * providers. Most of these pages contain a plain HLS m3u8 URL in their static
 * HTML, so we can extract it with a simple regex — no headless browser needed.
 *
 * Resolution chain per provider:
 *   alieztv  → fetch emb.apl408.me/player/live.php?id=CHANNEL_ID
 *              → regex pl.init('//HOST/hls/STREAM/index.m3u8?cst=TOKEN')
 *   voodc    → fetch voodc.com/embed/CHANNEL_ID
 *              → generic m3u8 regex
 *   generic  → fetch the embed page, look for any .m3u8 URL
 *
 * Returns a fully qualified https:// URL or null (caller falls back to browser).
 */

const EMBED_TIMEOUT_MS = 6_000;

const HEADERS = {
  "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
  Referer: "https://livetv.sx/",
};

async function fetchEmbed(url: string): Promise<string | null> {
  try {
    const res = await fetch(url, {
      headers: HEADERS,
      signal: AbortSignal.timeout(EMBED_TIMEOUT_MS),
      // @ts-ignore — Bun-specific TLS option
      tls: { rejectUnauthorized: false },
    });
    if (!res.ok) return null;
    return res.text();
  } catch {
    return null;
  }
}

/** Extract a protocol-relative or absolute m3u8 URL as a full https:// URL. */
function qualify(url: string): string {
  return url.startsWith("//") ? "https:" + url : url;
}

/**
 * Aliez TV: the player page contains  pl.init('//HOST/hls/STREAM/index.m3u8?cst=TOKEN')
 * The token and CDN hostname rotate per request; always fetch fresh.
 */
async function extractAliezStream(channelId: string): Promise<string | null> {
  const html = await fetchEmbed(`https://emb.apl408.me/player/live.php?id=${channelId}`);
  if (!html) return null;

  const match =
    html.match(/pl\.init\(\s*['"](\/{2}[^'"]+\.m3u8[^'"]*)['"]\s*\)/) ??
    html.match(/pl\.init\(\s*['"]([^'"]+\.m3u8[^'"]*)['"]\s*\)/);

  return match ? qualify(match[1]) : null;
}

/**
 * Generic extractor: look for the first .m3u8 URL in the embed page HTML.
 * Covers Voodc and any other provider we don't have a specific handler for.
 */
async function extractGenericEmbed(embedUrl: string): Promise<string | null> {
  const full = embedUrl.startsWith("//") ? "https:" + embedUrl : embedUrl;
  const html = await fetchEmbed(full);
  if (!html) return null;

  // Protocol-absolute https:// match first
  const abs = html.match(/["'](https?:\/\/[^"']+\.m3u8[^"']*?)["']/);
  if (abs) return abs[1];

  // Protocol-relative //HOST/path.m3u8
  const rel = html.match(/["'](\/{2}[^"']+\.m3u8[^"']*?)["']/);
  if (rel) return qualify(rel[1]);

  return null;
}

/**
 * Given the full embed page URL (e.g. from a webplayer StreamLink),
 * attempt to extract a playable HLS/m3u8 URL.
 *
 * Returns null when:
 *   - the channel is currently offline
 *   - the provider is not yet supported
 *   - the request times out or fails
 */
export async function resolveEmbedStream(embedUrl: string): Promise<string | null> {
  let url: URL;
  try {
    url = new URL(embedUrl.startsWith("//") ? "https:" + embedUrl : embedUrl);
  } catch {
    return null;
  }

  const provider = url.searchParams.get("t")?.toLowerCase();
  const channelId = url.searchParams.get("c");

  if (!channelId) return null;

  if (provider === "alieztv") {
    return extractAliezStream(channelId);
  }

  if (provider === "voodc") {
    return extractGenericEmbed(`https://voodc.com/embed/${channelId}`);
  }

  // Unknown provider — try the page itself
  return extractGenericEmbed(embedUrl);
}
