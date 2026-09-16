import { parse } from "node-html-parser";
import { fetchHtml } from "../http.js";
import { toCompositeId } from "../ids.js";
import type { EventDetail, LiveEvent, StreamLink } from "../types.js";
import type { SourceConnector } from "./types.js";

export const LIVETV_SOURCE_ID = "livetv";

const BASE_URL = process.env.LIVETV_BASE_URL ?? "https://livetv.sx";
const EVENTS_PATH = "/enx/allupcomingsports";

/** Resolve protocol-relative (`//cdn…`) and root-relative (`/webplayer.php`) hrefs. */
export function absoluteUrl(href: string, baseUrl = BASE_URL): string {
  if (/^https?:\/\//i.test(href) || href.startsWith("acestream://")) return href;
  try {
    return new URL(href, baseUrl).href;
  } catch {
    if (href.startsWith("//")) return `https:${href}`;
    const origin = baseUrl.replace(/\/+$/, "");
    return href.startsWith("/") ? `${origin}${href}` : `${origin}/${href}`;
  }
}

function extractEventId(href: string): string {
  const match = href.match(/\/eventinfo\/(\d+)/);
  return match ? match[1] : href;
}

const MONTH_ABBREVS = [
  "jan",
  "feb",
  "mar",
  "apr",
  "may",
  "jun",
  "jul",
  "aug",
  "sep",
  "oct",
  "nov",
  "dec",
];

export function parseEventDate(evdesc: string): string {
  const m = evdesc.match(/(\d{1,2}) ([A-Za-z]+) at /);
  if (!m) return "";
  const day = parseInt(m[1], 10);
  const monthIdx = MONTH_ABBREVS.findIndex((abbr) => m[2].toLowerCase().startsWith(abbr));
  if (monthIdx === -1) return "";
  const now = new Date();
  let year = now.getFullYear();
  if (monthIdx < now.getMonth() - 1) year += 1;
  return `${year}-${String(monthIdx + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

function extractEventMeta(td: ReturnType<typeof parse>): {
  sport: string;
  time: string;
  date: string;
  score: string | null;
  isLive: boolean;
} {
  const isLive = td.innerHTML.includes("live.gif");
  const evdesc = td.querySelector(".evdesc");
  const raw = evdesc?.text?.trim() ?? "";
  const timeMatch = raw.match(/at (\d{1,2}:\d{2})/);
  const time = timeMatch ? timeMatch[1] : "";
  const date = parseEventDate(raw);
  const sportMatch = raw.match(/\(([^)]+)\)/);
  const sport = sportMatch ? sportMatch[1] : "";
  return { sport, time, date, score: null, isLive };
}

function tagLivetvEvents(events: Omit<LiveEvent, "source">[]): LiveEvent[] {
  return events.map((e) => ({
    ...e,
    source: LIVETV_SOURCE_ID,
    id: toCompositeId(LIVETV_SOURCE_ID, e.id),
  }));
}

export function parseEventListFromHtml(html: string, baseUrl = BASE_URL): LiveEvent[] {
  const root = parse(html);
  const events: Omit<LiveEvent, "source">[] = [];
  const seen = new Set<string>();

  for (const anchor of root.querySelectorAll("table.main a[href*='/eventinfo/']")) {
    const href = anchor.getAttribute("href") ?? "";
    if (!href.includes("/eventinfo/")) continue;

    const nativeId = extractEventId(href);
    if (seen.has(nativeId)) continue;
    seen.add(nativeId);

    const name = anchor.text.trim();
    if (!name) continue;

    const slugMatch = href.match(/\/eventinfo\/\d+_([^/]+)\//);
    const slug = slugMatch ? slugMatch[1] : nativeId;

    const parentTd = anchor.parentNode;
    const meta = extractEventMeta(parentTd as ReturnType<typeof parse>);

    events.push({
      id: nativeId,
      name,
      slug,
      sport: meta.sport,
      time: meta.time,
      date: meta.date,
      score: meta.score,
      isLive: meta.isLive,
      url: absoluteUrl(href, baseUrl),
      posterUrl: null,
    });
  }

  return tagLivetvEvents(events);
}

export function parseStreamLinksFromHtml(html: string, baseUrl = BASE_URL): StreamLink[] {
  return parseStreamLinks(parse(html), baseUrl);
}

function parseStreamLinks(root: ReturnType<typeof parse>, baseUrl = BASE_URL): StreamLink[] {
  const streams: StreamLink[] = [];

  for (const table of root.querySelectorAll("table.lnktbj")) {
    const anchors = table.querySelectorAll("a");
    if (!anchors.length) continue;

    const lastAnchor = anchors[anchors.length - 1];
    const href = lastAnchor.getAttribute("href") ?? "";
    if (!href || href === "/") continue;

    const bitrateTd = table.querySelector("td.bitrate");
    const bitrate = bitrateTd?.text?.trim() || null;

    if (href.startsWith("acestream://")) {
      streams.push({ type: "acestream", url: href, bitrate, provider: "AceStream" });
    } else if (href.includes("youtub")) {
      const youtubeIdMatch = href.match(/[?&](?:v=|c=)([A-Za-z0-9_-]{11})/);
      const videoId = youtubeIdMatch ? youtubeIdMatch[1] : null;
      if (videoId) {
        streams.push({
          type: "youtube",
          url: `https://www.youtube.com/watch?v=${videoId}`,
          bitrate,
          provider: "YouTube",
        });
      }
    } else if (href.includes("webplayer") || href.includes("alieztv") || href.includes("ifr")) {
      let provider = "Web";
      if (href.includes("alieztv")) provider = "Aliez";
      else if (href.includes("voodc")) provider = "Voodc";
      streams.push({ type: "webplayer", url: absoluteUrl(href, baseUrl), bitrate, provider });
    }
  }

  return streams;
}

async function loadLivetvEventDetail(nativeId: string): Promise<EventDetail | null> {
  const url = `${BASE_URL}/enx/eventinfo/${nativeId}/`;
  const html = await fetchHtml(url, { insecureTls: true });
  const root = parse(html);

  const titleEl = root.querySelector("title");
  const rawTitle = titleEl?.text ?? "";
  const namePart = rawTitle.split("|")[0].replace(" Live Stream", "").trim();

  const sportEl = root.querySelector("span.sporttitle");
  const sport = sportEl?.text?.trim() ?? "";

  let posterUrl: string | null = null;
  for (const alt of ["Standings", "Table", "Classifica"]) {
    const img = root.querySelector(`img[alt="${alt}"]`);
    const src = img?.getAttribute("src");
    if (src) {
      posterUrl = absoluteUrl(src);
      break;
    }
  }

  const streams = parseStreamLinks(root);

  return {
    id: toCompositeId(LIVETV_SOURCE_ID, nativeId),
    source: LIVETV_SOURCE_ID,
    name: namePart || `Event ${nativeId}`,
    slug: nativeId,
    sport,
    time: "",
    date: "",
    score: null,
    isLive: streams.length > 0,
    url,
    posterUrl,
    streams,
  };
}

export const livetvConnector: SourceConnector = {
  id: LIVETV_SOURCE_ID,
  displayName: "LiveTV.sx",
  baseUrl: BASE_URL,
  async listEvents() {
    const html = await fetchHtml(`${BASE_URL}${EVENTS_PATH}`, { insecureTls: true });
    return parseEventListFromHtml(html);
  },
  getEventDetail: loadLivetvEventDetail,
};

/** Livetv-only fetch (single source). Prefer `fetchEvents(["livetv"])` from aggregator. */
export async function fetchLivetvEvents(): Promise<LiveEvent[]> {
  return livetvConnector.listEvents();
}

export async function fetchLivetvEventDetail(eventId: string): Promise<EventDetail | null> {
  const nativeId = eventId.includes(":") ? eventId.split(":").slice(1).join(":") : eventId;
  return loadLivetvEventDetail(nativeId);
}
