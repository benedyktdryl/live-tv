import type { StreamLink } from "./types.js";

const ACE_ENGINE_HOST = process.env.ACE_ENGINE_HOST ?? "127.0.0.1";
const ACE_ENGINE_PORT = process.env.ACE_ENGINE_PORT ?? "6878";
const ACE_BASE = `http://${ACE_ENGINE_HOST}:${ACE_ENGINE_PORT}`;

export interface ResolvedStream {
  /** Display name shown in Stremio stream picker */
  name: string;
  /** The URL to stream (VLC / Stremio player). Empty string when isExternal is true. */
  url: string;
  /** Short provider tag shown under stream name */
  description: string;
  /**
   * When true this is a browser-embed link (Aliez, Voodc, etc.) that cannot be
   * played directly. Stremio should open it with externalUrl; the CLI should
   * open the system browser.
   */
  isExternal: boolean;
}

/**
 * Check whether the local AceStream engine is reachable.
 */
export async function isAceEngineAvailable(): Promise<boolean> {
  try {
    const res = await fetch(`${ACE_BASE}/webui/api/service?method=get_version`, {
      signal: AbortSignal.timeout(2000),
    });
    return res.ok;
  } catch {
    return false;
  }
}

/**
 * Convert a raw stream link into one or more resolved stream objects.
 *
 * AceStream hashes produce two options:
 *   A) acestream://HASH  — opened by AceStream app if installed (URI scheme)
 *   B) http://ACE_ENGINE/ace/getstream?content_id=HASH — requires running engine
 *
 * Web-player embeds (Aliez, Voodc, etc.) are marked isExternal=true so callers
 * know to open them in a browser rather than attempt direct playback.
 */
export function resolveStream(link: StreamLink): ResolvedStream[] {
  if (link.type === "acestream") {
    const hash = link.url.replace("acestream://", "");
    const bitrate = link.bitrate ? ` · ${link.bitrate}` : "";
    return [
      {
        name: `AceStream${bitrate}`,
        url: link.url,
        description: "AceStream app / URI handler",
        isExternal: false,
      },
      {
        name: `AceStream Engine${bitrate}`,
        url: `${ACE_BASE}/ace/getstream?content_id=${hash}`,
        description: `Engine at ${ACE_ENGINE_HOST}:${ACE_ENGINE_PORT}`,
        isExternal: false,
      },
    ];
  }

  if (link.type === "youtube") {
    return [
      {
        name: "YouTube",
        url: link.url,
        description: "YouTube broadcast",
        isExternal: false,
      },
    ];
  }

  // Web-player embeds — these are HTML pages, not direct streams.
  // Mark isExternal so callers open them in a browser.
  const bitrate = link.bitrate ? ` · ${link.bitrate}` : "";
  return [
    {
      name: `${link.provider}${bitrate}`,
      url: link.url,
      description: `Web embed — opens in browser`,
      isExternal: true,
    },
  ];
}

/**
 * Resolve all stream links for an event.
 * Order: acestream first (highest bitrate), then youtube, then web embeds.
 */
export function resolveStreams(links: StreamLink[]): ResolvedStream[] {
  const sorted = [...links].sort((a, b) => {
    const rank = (t: StreamLink["type"]) => (t === "acestream" ? 0 : t === "youtube" ? 1 : 2);
    const dr = rank(a.type) - rank(b.type);
    if (dr !== 0) return dr;
    return parseInt(b.bitrate ?? "0") - parseInt(a.bitrate ?? "0");
  });

  return sorted.flatMap(resolveStream);
}

/**
 * Return the best URL for direct VLC playback.
 * Prefers the AceStream engine HTTP URL, falls back to YouTube, ignores web embeds.
 */
export function bestVlcUrl(links: StreamLink[]): string | null {
  const ace = links.find((l) => l.type === "acestream");
  if (ace) {
    const hash = ace.url.replace("acestream://", "");
    return `${ACE_BASE}/ace/getstream?content_id=${hash}`;
  }
  const yt = links.find((l) => l.type === "youtube");
  return yt?.url ?? null;
}

/**
 * Return the best URL to open in a browser (web embeds, YouTube fallback).
 * Returns null if there are no browser-openable streams.
 */
export function bestBrowserUrl(links: StreamLink[]): string | null {
  const web = links.find((l) => l.type === "webplayer");
  if (web) return web.url;
  const yt = links.find((l) => l.type === "youtube");
  return yt?.url ?? null;
}
