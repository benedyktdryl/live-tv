import type { StreamLink } from "./types.js";

const ACE_ENGINE_HOST = process.env.ACE_ENGINE_HOST ?? "127.0.0.1";
const ACE_ENGINE_PORT = process.env.ACE_ENGINE_PORT ?? "6878";
const ACE_BASE = `http://${ACE_ENGINE_HOST}:${ACE_ENGINE_PORT}`;

export interface ResolvedStream {
  /** Display name shown in Stremio stream picker */
  name: string;
  /** The URL Stremio or VLC will open */
  url: string;
  /** Short provider tag shown under stream name */
  description: string;
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
 * Convert a raw stream link into one or more Stremio-compatible stream objects.
 *
 * For AceStream hashes we return two options:
 *   A) acestream://HASH  — handled natively by Stremio if AceStream app is installed
 *   B) http://localhost:6878/ace/getstream?content_id=HASH — works when engine is running
 */
export function resolveStream(link: StreamLink): ResolvedStream[] {
  if (link.type === "acestream") {
    const hash = link.url.replace("acestream://", "");
    const bitrate = link.bitrate ? ` · ${link.bitrate}` : "";
    const results: ResolvedStream[] = [
      {
        name: `AceStream${bitrate}`,
        url: link.url,
        description: "AceStream app required",
      },
      {
        name: `AceStream Engine${bitrate}`,
        url: `${ACE_BASE}/ace/getstream?content_id=${hash}`,
        description: "AceStream engine on localhost:6878",
      },
    ];
    return results;
  }

  if (link.type === "youtube") {
    return [
      {
        name: "YouTube",
        url: link.url,
        description: "YouTube broadcast",
      },
    ];
  }

  // webplayer links — return as-is; Stremio may be able to open them
  const bitrate = link.bitrate ? ` · ${link.bitrate}` : "";
  return [
    {
      name: `${link.provider}${bitrate}`,
      url: link.url,
      description: `Browser embed (${link.provider})`,
    },
  ];
}

/**
 * Resolve all stream links for an event into Stremio stream objects.
 * AceStream links are prioritised by sorting them first, then by bitrate descending.
 */
export function resolveStreams(links: StreamLink[]): ResolvedStream[] {
  // Sort: acestream first, then by numeric bitrate desc
  const sorted = [...links].sort((a, b) => {
    if (a.type === "acestream" && b.type !== "acestream") return -1;
    if (b.type === "acestream" && a.type !== "acestream") return 1;
    const ba = parseInt(a.bitrate ?? "0");
    const bb = parseInt(b.bitrate ?? "0");
    return bb - ba;
  });

  return sorted.flatMap(resolveStream);
}

/**
 * Return the best single VLC-playable URL for a list of stream links.
 * Prefers the AceStream engine HTTP URL for VLC compatibility.
 */
export function bestVlcUrl(links: StreamLink[]): string | null {
  const ace = links.find((l) => l.type === "acestream");
  if (ace) {
    const hash = ace.url.replace("acestream://", "");
    return `${ACE_BASE}/ace/getstream?content_id=${hash}`;
  }
  const web = links.find((l) => l.type === "webplayer" || l.type === "youtube");
  return web?.url ?? null;
}
