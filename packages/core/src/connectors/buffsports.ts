import { parse } from "node-html-parser";
import { fetchHtml } from "../http.js";
import { toCompositeId } from "../ids.js";
import type { EventDetail, LiveEvent, StreamLink } from "../types.js";
import type { SourceConnector } from "./types.js";

export const BUFFSPORTS_SOURCE_ID = "buffsports";

const BASE_URL = process.env.BUFFSPORTS_BASE_URL ?? "https://buffsports.io";
const SOCCER_PATH = "/watch-soccer";

/** Paths like `/soccer/live-team-a-vs-team-b` */
const EVENT_HREF_RE = /^\/[a-z0-9-]+\/live-[a-z0-9-]+$/i;

export interface BuffsportsRawEvent {
  nativeId: string;
  name: string;
  sport: string;
  time: string;
  date: string;
  isLive: boolean;
  path: string;
}

export function slugFromPath(path: string): string {
  return path.replace(/^\//, "");
}

export function parseBuffsportsEventListFromHtml(
  html: string,
  baseUrl = BASE_URL,
): BuffsportsRawEvent[] {
  const root = parse(html);
  const events: BuffsportsRawEvent[] = [];
  const seen = new Set<string>();

  for (const anchor of root.querySelectorAll("a[href]")) {
    const href = anchor.getAttribute("href") ?? "";
    if (!EVENT_HREF_RE.test(href)) continue;

    const nativeId = slugFromPath(href);
    if (seen.has(nativeId)) continue;
    seen.add(nativeId);

    const title = anchor.getAttribute("title")?.trim();
    const name =
      title ||
      anchor.text
        .replace(/\s+/g, " ")
        .trim()
        .replace(/^\d{1,2}:\d{2}\s*/, "");
    if (!name) continue;

    const sportClass = anchor.querySelector("span")?.getAttribute("class") ?? "";
    const sportMatch = sportClass.match(/buffstreams\s+\S+\s+(\S+)/);
    const sport = sportMatch ? sportMatch[1] : "Soccer";

    const timeEl = anchor.querySelector("span[content]");
    const iso = timeEl?.getAttribute("content") ?? "";
    let time = "";
    let date = "";
    if (iso) {
      const m = iso.match(/^(\d{4}-\d{2}-\d{2})T(\d{2}:\d{2})/);
      if (m) {
        date = m[1];
        time = m[2];
      }
    } else {
      const timeSpan = anchor.querySelector("span.w5m8n4e2u0");
      time = timeSpan?.text?.trim() ?? "";
      date = timeEl?.getAttribute("data-j2m5g7e4b6") ?? "";
    }

    const classAttr = anchor.getAttribute("class") ?? "";
    const isLive = /\btext-primary\b/.test(classAttr);

    events.push({
      nativeId,
      name,
      sport,
      time,
      date,
      isLive,
      path: href,
    });
  }

  return events;
}

function toLiveEvents(raw: BuffsportsRawEvent[]): LiveEvent[] {
  return raw.map((e) => ({
    id: toCompositeId(BUFFSPORTS_SOURCE_ID, e.nativeId),
    source: BUFFSPORTS_SOURCE_ID,
    name: e.name,
    slug: e.nativeId,
    sport: e.sport,
    time: e.time,
    date: e.date,
    score: null,
    isLive: e.isLive,
    url: `${BASE_URL}${e.path}`,
    posterUrl: null,
  }));
}

export function parseBuffsportsStreamsFromHtml(html: string, pageUrl: string): StreamLink[] {
  const streams: StreamLink[] = [];
  const iframeMatch = html.match(/<iframe[^>]+src=["']([^"']+)["']/i);
  if (iframeMatch?.[1] && !iframeMatch[1].includes("googletagmanager")) {
    const url = iframeMatch[1].startsWith("http")
      ? iframeMatch[1]
      : new URL(iframeMatch[1], pageUrl).href;
    streams.push({ type: "webplayer", url, bitrate: null, provider: "BuffStreams" });
  }
  const m3u8Match = html.match(/(https?:\/\/[^\s"'<>]+\.m3u8[^\s"'<>]*)/i);
  if (m3u8Match?.[1]) {
    streams.push({ type: "webplayer", url: m3u8Match[1], bitrate: null, provider: "HLS" });
  }
  if (streams.length === 0) {
    streams.push({ type: "webplayer", url: pageUrl, bitrate: null, provider: "BuffStreams" });
  }
  return streams;
}

async function fetchBuffsportsDetail(nativeId: string): Promise<EventDetail | null> {
  const path = nativeId.startsWith("/") ? nativeId : `/${nativeId}`;
  const url = `${BASE_URL}${path}`;
  const html = await fetchHtml(url);
  const streams = parseBuffsportsStreamsFromHtml(html, url);

  const titleMatch = html.match(/<title>([^<]+)<\/title>/i);
  const name = titleMatch?.[1]?.split("|")[0]?.trim() ?? nativeId;

  return {
    id: toCompositeId(BUFFSPORTS_SOURCE_ID, nativeId),
    source: BUFFSPORTS_SOURCE_ID,
    name,
    slug: nativeId,
    sport: nativeId.split("/")[0] ?? "sports",
    time: "",
    date: "",
    score: null,
    isLive: streams.length > 0,
    url,
    posterUrl: null,
    streams,
  };
}

export const buffsportsConnector: SourceConnector = {
  id: BUFFSPORTS_SOURCE_ID,
  displayName: "BuffStreams",
  baseUrl: BASE_URL,
  async listEvents() {
    const html = await fetchHtml(`${BASE_URL}${SOCCER_PATH}`);
    return toLiveEvents(parseBuffsportsEventListFromHtml(html));
  },
  getEventDetail: fetchBuffsportsDetail,
};
