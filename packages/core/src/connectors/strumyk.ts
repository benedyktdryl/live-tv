import { parse } from "node-html-parser";
import { fetchHtml, isCloudflareChallengePage } from "../http.js";
import { toCompositeId } from "../ids.js";
import type { EventDetail, LiveEvent, StreamLink } from "../types.js";
import type { SourceConnector } from "./types.js";

export const STRUMYK_SOURCE_ID = "strumyk";

const BASE_URL = process.env.STRUMYK_BASE_URL ?? "https://strumyk.cfd";

export interface StrumykRawEvent {
  nativeId: string;
  name: string;
  sport: string;
  time: string;
  date: string;
  isLive: boolean;
  path: string;
  streamHref: string | null;
}

/**
 * Parse Strumyk schedule HTML.
 * Supports card/list layouts with links to `/mecz/…`, `/stream/…`, or `/watch/…`.
 */
export function parseStrumykEventListFromHtml(html: string, baseUrl = BASE_URL): StrumykRawEvent[] {
  const root = parse(html);
  const events: StrumykRawEvent[] = [];
  const seen = new Set<string>();

  const linkSelectors = [
    "a[href*='/mecz/']",
    "a[href*='/stream/']",
    "a[href*='/watch/']",
    "a[href*='/live/']",
    ".event-card a[href]",
    ".match-card a[href]",
  ];

  for (const selector of linkSelectors) {
    for (const anchor of root.querySelectorAll(selector)) {
      const href = anchor.getAttribute("href") ?? "";
      if (!href || href === "#" || href.startsWith("javascript:")) continue;

      const path = href.startsWith("http") ? new URL(href).pathname : href;
      const nativeId = path.replace(/^\//, "").replace(/\/$/, "");
      if (!nativeId || seen.has(nativeId)) continue;
      seen.add(nativeId);

      const name =
        anchor.getAttribute("title")?.trim() ||
        anchor.querySelector(".title, .name, h2, h3")?.text?.trim() ||
        anchor.text.replace(/\s+/g, " ").trim();
      if (!name || name.length < 3) continue;

      const sportEl = anchor.closest(".sport, [data-sport], section");
      const sport =
        sportEl?.getAttribute("data-sport") ||
        sportEl?.querySelector("h2, h3, .sport-name")?.text?.trim() ||
        "Sports";

      const time =
        anchor.querySelector(".time, [data-time]")?.text?.trim() ||
        anchor.getAttribute("data-time") ||
        "";
      const date =
        anchor.getAttribute("data-date") ||
        anchor.closest("[data-date]")?.getAttribute("data-date") ||
        "";

      const isLive =
        anchor.classList.contains("live") ||
        !!anchor.querySelector(".live, .badge-live") ||
        /live|na żywo/i.test(anchor.innerHTML);

      events.push({
        nativeId,
        name,
        sport,
        time,
        date,
        isLive,
        path,
        streamHref: href.startsWith("http") ? href : null,
      });
    }
  }

  return events;
}

function toLiveEvents(raw: StrumykRawEvent[]): LiveEvent[] {
  return raw.map((e) => {
    const url = e.streamHref ?? `${BASE_URL}/${e.path}`;
    return {
      id: toCompositeId(STRUMYK_SOURCE_ID, e.nativeId),
      source: STRUMYK_SOURCE_ID,
      name: e.name,
      slug: e.nativeId,
      sport: e.sport,
      time: e.time,
      date: e.date,
      score: null,
      isLive: e.isLive,
      url,
      posterUrl: null,
    };
  });
}

export function parseStrumykStreamsFromHtml(html: string, pageUrl: string): StreamLink[] {
  const streams: StreamLink[] = [];
  const iframeMatch = html.match(/<iframe[^>]+src=["']([^"']+)["']/i);
  if (iframeMatch?.[1]) {
    const url = iframeMatch[1].startsWith("http")
      ? iframeMatch[1]
      : new URL(iframeMatch[1], pageUrl).href;
    streams.push({ type: "webplayer", url, bitrate: null, provider: "Strumyk" });
  }
  const m3u8Match = html.match(/(https?:\/\/[^\s"'<>]+\.m3u8[^\s"'<>]*)/i);
  if (m3u8Match?.[1]) {
    streams.push({ type: "webplayer", url: m3u8Match[1], bitrate: null, provider: "HLS" });
  }
  if (streams.length === 0) {
    streams.push({ type: "webplayer", url: pageUrl, bitrate: null, provider: "Strumyk" });
  }
  return streams;
}

async function fetchStrumykDetail(nativeId: string): Promise<EventDetail | null> {
  const path = nativeId.startsWith("/") ? nativeId : `/${nativeId}`;
  const url = `${BASE_URL}${path}`;
  let html: string;
  try {
    html = await fetchHtml(url);
  } catch {
    return null;
  }
  const streams = parseStrumykStreamsFromHtml(html, url);
  const titleMatch = html.match(/<title>([^<]+)<\/title>/i);
  const name = titleMatch?.[1]?.split("|")[0]?.trim() ?? nativeId;

  return {
    id: toCompositeId(STRUMYK_SOURCE_ID, nativeId),
    source: STRUMYK_SOURCE_ID,
    name,
    slug: nativeId,
    sport: "Sports",
    time: "",
    date: "",
    score: null,
    isLive: streams.length > 0,
    url,
    posterUrl: null,
    streams,
  };
}

async function fetchStrumykScheduleHtml(): Promise<string | null> {
  try {
    const html = await fetchHtml(`${BASE_URL}/`);
    if (isCloudflareChallengePage(html)) {
      console.warn(
        "[strumyk] Cloudflare challenge at",
        BASE_URL,
        "— no events (refresh fixtures or use a network that passes CF)",
      );
      return null;
    }
    return html;
  } catch (err) {
    console.warn("[strumyk] schedule fetch failed:", err);
    return null;
  }
}

export const strumykConnector: SourceConnector = {
  id: STRUMYK_SOURCE_ID,
  displayName: "Strumyk",
  baseUrl: BASE_URL,
  async listEvents() {
    const html = await fetchStrumykScheduleHtml();
    if (!html) return [];
    return toLiveEvents(parseStrumykEventListFromHtml(html));
  },
  getEventDetail: fetchStrumykDetail,
};
