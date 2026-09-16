import { parse } from "node-html-parser";
import { fetchHtml } from "../http.js";
import { toCompositeId } from "../ids.js";
import type { EventDetail, LiveEvent, StreamLink } from "../types.js";
import type { SourceConnector } from "./types.js";

export const DLHD_SOURCE_ID = "dlhd";

const BASE_URL = process.env.DLHD_BASE_URL ?? "https://dlhd.pk";

export interface DlhdRawEvent {
  nativeId: string;
  name: string;
  sport: string;
  time: string;
  date: string;
  isLive: boolean;
  channels: { id: string; name: string; href: string }[];
}

/** Stable id from schedule event title + time */
export function dlhdEventNativeId(title: string, time: string): string {
  const slug = title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 80);
  const t = time.replace(/:/g, "");
  return `${t}-${slug}`;
}

function parseScheduleDay(root: ReturnType<typeof parse>, dayTitle: string): string {
  const m = dayTitle.match(/(\d{4}-\d{2}-\d{2})/);
  return m ? m[1] : "";
}

export function parseDlhdScheduleFromHtml(html: string, baseUrl = BASE_URL): DlhdRawEvent[] {
  const root = parse(html);
  const events: DlhdRawEvent[] = [];
  let currentDate = new Date().toISOString().slice(0, 10);
  let currentCategory = "";

  for (const el of root.querySelectorAll(
    ".schedule__dayTitle, .schedule__catHeader, .schedule__event",
  )) {
    if (el.classList.contains("schedule__dayTitle")) {
      const parsed = parseScheduleDay(el, el.text.trim());
      if (parsed) currentDate = parsed;
      continue;
    }
    if (el.classList.contains("schedule__catHeader")) {
      currentCategory = el.text.trim();
      continue;
    }
    if (!el.classList.contains("schedule__event")) continue;

    const header = el.querySelector(".schedule__eventHeader");
    const titleEl = el.querySelector(".schedule__eventTitle");
    const timeEl = el.querySelector(".schedule__time");
    const name = titleEl?.text?.trim() ?? header?.getAttribute("data-title") ?? "";
    if (!name) continue;

    const time = timeEl?.getAttribute("data-time") ?? timeEl?.text?.trim() ?? "";
    const channels: DlhdRawEvent["channels"] = [];

    for (const ch of el.querySelectorAll(".schedule__channels a")) {
      const href = ch.getAttribute("href") ?? "";
      const idMatch = href.match(/[?&]id=(\d+)/) ?? href.match(/stream-(\d+)\.php/);
      const chId = idMatch ? idMatch[1] : href;
      const chName = ch.getAttribute("title")?.trim() || ch.text.trim();
      if (!chName) continue;
      const fullHref = href.startsWith("http") ? href : `${baseUrl}${href}`;
      channels.push({ id: chId, name: chName, href: fullHref });
    }

    if (channels.length === 0) continue;

    const nativeId = dlhdEventNativeId(name, time);
    events.push({
      nativeId,
      name,
      sport: currentCategory || "Sports",
      time,
      date: currentDate,
      isLive: false,
      channels,
    });
  }

  return events;
}

function toLiveEvents(raw: DlhdRawEvent[]): LiveEvent[] {
  return raw.map((e) => ({
    id: toCompositeId(DLHD_SOURCE_ID, e.nativeId),
    source: DLHD_SOURCE_ID,
    name: e.name,
    slug: e.nativeId,
    sport: e.sport,
    time: e.time,
    date: e.date,
    score: null,
    isLive: e.isLive,
    url: `${BASE_URL}/`,
    posterUrl: null,
  }));
}

function channelsToStreams(channels: DlhdRawEvent["channels"]): StreamLink[] {
  return channels.map((ch) => {
    const streamPage = ch.href.includes("watch.php")
      ? `${BASE_URL}/stream/stream-${ch.id}.php`
      : ch.href;
    return {
      type: "webplayer" as const,
      url: streamPage.startsWith("http") ? streamPage : `${BASE_URL}${streamPage}`,
      bitrate: null,
      provider: ch.name,
    };
  });
}

let scheduleCache: { at: number; events: DlhdRawEvent[] } | null = null;
const SCHEDULE_CACHE_MS = 3 * 60 * 1000;

async function loadSchedule(): Promise<DlhdRawEvent[]> {
  if (scheduleCache && Date.now() - scheduleCache.at < SCHEDULE_CACHE_MS) {
    return scheduleCache.events;
  }
  const html = await fetchHtml(`${BASE_URL}/`);
  const events = parseDlhdScheduleFromHtml(html);
  scheduleCache = { at: Date.now(), events };
  return events;
}

async function fetchDlhdDetail(nativeId: string): Promise<EventDetail | null> {
  const schedule = await loadSchedule();
  const raw = schedule.find((e) => e.nativeId === nativeId);
  if (!raw) return null;

  const streams = channelsToStreams(raw.channels);
  return {
    id: toCompositeId(DLHD_SOURCE_ID, nativeId),
    source: DLHD_SOURCE_ID,
    name: raw.name,
    slug: nativeId,
    sport: raw.sport,
    time: raw.time,
    date: raw.date,
    score: null,
    isLive: raw.isLive,
    url: `${BASE_URL}/`,
    posterUrl: null,
    streams,
  };
}

export const dlhdConnector: SourceConnector = {
  id: DLHD_SOURCE_ID,
  displayName: "DaddyLive (DLHD)",
  baseUrl: BASE_URL,
  async listEvents() {
    return toLiveEvents(await loadSchedule());
  },
  getEventDetail: fetchDlhdDetail,
};
