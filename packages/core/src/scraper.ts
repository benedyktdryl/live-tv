import { parse } from "node-html-parser";
import type { EventDetail, LiveEvent, StreamLink } from "./types.js";

const BASE_URL = process.env.LIVETV_BASE_URL ?? "https://livetv.sx";
const EVENTS_PATH = "/enx/allupcomingsports";
const FETCH_HEADERS = {
  "User-Agent":
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
  Accept: "text/html,application/xhtml+xml",
  "Accept-Language": "en-US,en;q=0.9",
};

async function fetchHtml(url: string): Promise<string> {
  const res = await fetch(url, {
    headers: FETCH_HEADERS,
    // livetv.sx uses a certificate chain that fails standard verification
    // @ts-ignore — Bun-specific TLS option
    tls: { rejectUnauthorized: false },
  });
  if (!res.ok) throw new Error(`HTTP ${res.status} fetching ${url}`);
  return res.text();
}

/**
 * Extract the numeric event ID from a livetv.sx eventinfo href.
 * e.g. "/enx/eventinfo/371315132_aston_villa_tottenham/" → "371315132"
 */
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

/**
 * Parse an ISO date string from evdesc text like "4 May at 9:30 (Sport)".
 * Returns "YYYY-MM-DD" or "" when the date cannot be determined.
 * Exported for snapshot testing.
 */
export function parseEventDate(evdesc: string): string {
  const m = evdesc.match(/(\d{1,2}) ([A-Za-z]+) at /);
  if (!m) return "";
  const day = parseInt(m[1], 10);
  const monthIdx = MONTH_ABBREVS.findIndex((abbr) => m[2].toLowerCase().startsWith(abbr));
  if (monthIdx === -1) return "";
  const now = new Date();
  let year = now.getFullYear();
  // If the parsed month is earlier than current month by more than one,
  // the event is likely in the next calendar year (e.g., January scraped in December).
  if (monthIdx < now.getMonth() - 1) year += 1;
  return `${year}-${String(monthIdx + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

/**
 * Extract event metadata from the <td> containing the anchor.
 *
 * HTML structure (per row):
 *   <td>
 *     <a class="live" href="/enx/eventinfo/ID_slug/">Event Name</a>
 *     <br>
 *     <a class="live" href="..."><img src="//cdn.../live.gif"></a>  ← only when truly LIVE
 *     <span class="live">...</span>
 *     <br>
 *     <span class="evdesc">HH:MM (Tournament)</span>
 *   </td>
 */
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

  // evdesc format: "D Month at HH:MM\n(Tournament Name)"
  const timeMatch = raw.match(/at (\d{1,2}:\d{2})/);
  const time = timeMatch ? timeMatch[1] : "";

  const date = parseEventDate(raw);

  const sportMatch = raw.match(/\(([^)]+)\)/);
  const sport = sportMatch ? sportMatch[1] : "";

  return { sport, time, date, score: null, isLive };
}

/**
 * Pure parser: extract events from an already-fetched event-list HTML string.
 * Exported for snapshot testing without network access.
 */
export function parseEventListFromHtml(html: string, baseUrl = BASE_URL): LiveEvent[] {
  const root = parse(html);
  const events: LiveEvent[] = [];
  const seen = new Set<string>();

  for (const anchor of root.querySelectorAll("table.main a[href*='/eventinfo/']")) {
    const href = anchor.getAttribute("href") ?? "";
    if (!href.includes("/eventinfo/")) continue;

    const id = extractEventId(href);
    if (seen.has(id)) continue;
    seen.add(id);

    const name = anchor.text.trim();
    if (!name) continue;

    const slugMatch = href.match(/\/eventinfo\/\d+_([^/]+)\//);
    const slug = slugMatch ? slugMatch[1] : id;

    const parentTd = anchor.parentNode;
    const meta = extractEventMeta(parentTd as ReturnType<typeof parse>);

    events.push({
      id,
      name,
      slug,
      sport: meta.sport,
      time: meta.time,
      date: meta.date,
      score: meta.score,
      isLive: meta.isLive,
      url: `${baseUrl}${href}`,
      posterUrl: null,
    });
  }

  return events;
}

/**
 * Fetch the list of all upcoming/live sports events.
 */
export async function fetchEvents(): Promise<LiveEvent[]> {
  const html = await fetchHtml(`${BASE_URL}${EVENTS_PATH}`);
  return parseEventListFromHtml(html);
}

/**
 * Pure parser: extract stream links from an event-detail HTML string.
 * Exported for snapshot testing without network access.
 */
export function parseStreamLinksFromHtml(html: string): StreamLink[] {
  return parseStreamLinks(parse(html));
}

/**
 * Parse stream links from an event page.
 * The page has sections:
 *   - "Browser Links" via table.lnktbj with webplayer hrefs
 *   - "AceStream Links" via table.lnktbj with acestream:// hrefs
 */
function parseStreamLinks(root: ReturnType<typeof parse>): StreamLink[] {
  const streams: StreamLink[] = [];

  for (const table of root.querySelectorAll("table.lnktbj")) {
    const anchors = table.querySelectorAll("a");
    if (!anchors.length) continue;

    // The last anchor in the row holds the actual stream href
    const lastAnchor = anchors[anchors.length - 1];
    const href = lastAnchor.getAttribute("href") ?? "";
    if (!href || href === "/") continue;

    const bitrateTd = table.querySelector("td.bitrate");
    const bitrate = bitrateTd?.text?.trim() || null;

    if (href.startsWith("acestream://")) {
      streams.push({ type: "acestream", url: href, bitrate, provider: "AceStream" });
    } else if (href.includes("youtub")) {
      // Extract YouTube video ID from webplayer params
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
      const fullUrl = href.startsWith("http") ? href : `https:${href}`;
      let provider = "Web";
      if (href.includes("alieztv")) provider = "Aliez";
      else if (href.includes("voodc")) provider = "Voodc";
      streams.push({ type: "webplayer", url: fullUrl, bitrate, provider });
    }
  }

  return streams;
}

/**
 * Fetch full details for a single event including all stream links.
 */
export async function fetchEventDetail(eventId: string): Promise<EventDetail | null> {
  // We fetch from a known URL pattern; if we don't have the slug we use a bare path
  // The site accepts just the ID: /enx/eventinfo/371315132/
  const url = `${BASE_URL}/enx/eventinfo/${eventId}/`;
  const html = await fetchHtml(url);
  const root = parse(html);

  // Title from <title> tag: "Team A – Team B Live Stream | League, date | LiveTV"
  const titleEl = root.querySelector("title");
  const rawTitle = titleEl?.text ?? "";
  const namePart = rawTitle.split("|")[0].replace(" Live Stream", "").trim();

  // Sport
  const sportEl = root.querySelector("span.sporttitle");
  const sport = sportEl?.text?.trim() ?? "";

  // Logo / poster — look for standings/table image
  let posterUrl: string | null = null;
  for (const alt of ["Standings", "Table", "Classifica"]) {
    const img = root.querySelector(`img[alt="${alt}"]`);
    const src = img?.getAttribute("src");
    if (src) {
      posterUrl = src.startsWith("http") ? src : `https:${src}`;
      break;
    }
  }

  const streams = parseStreamLinks(root);

  return {
    id: eventId,
    name: namePart || `Event ${eventId}`,
    slug: eventId,
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
