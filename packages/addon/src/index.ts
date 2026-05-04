import { createRequire } from "module";
import { fetchEvents, fetchEventDetail, resolveStreams } from "@live-tv/core";

const require = createRequire(import.meta.url);
const { addonBuilder, serveHTTP } = require("stremio-addon-sdk");

const PORT = parseInt(process.env.PORT ?? "7000", 10);

// ─── TTL cache ────────────────────────────────────────────────────────────────

const EVENTS_TTL_MS = 5 * 60 * 1000; // 5 minutes

let eventsCache: Awaited<ReturnType<typeof fetchEvents>> = [];
let eventsCachedAt = 0;

async function getCachedEvents() {
  if (Date.now() - eventsCachedAt < EVENTS_TTL_MS) return eventsCache;
  try {
    eventsCache = await fetchEvents();
    eventsCachedAt = Date.now();
    console.log(`[cache] refreshed ${eventsCache.length} events`);
  } catch (err) {
    console.error("[cache] failed to refresh events:", err);
  }
  return eventsCache;
}

// Per-event detail cache (keyed by event ID, expires after 2 min while live)
const detailCache = new Map<string, { data: Awaited<ReturnType<typeof fetchEventDetail>>; at: number }>();
const DETAIL_TTL_MS = 2 * 60 * 1000;

async function getCachedDetail(id: string) {
  const cached = detailCache.get(id);
  if (cached && Date.now() - cached.at < DETAIL_TTL_MS) return cached.data;
  const data = await fetchEventDetail(id);
  if (data) detailCache.set(id, { data, at: Date.now() });
  return data;
}

// ─── Addon manifest ──────────────────────────────────────────────────────────

const builder = new addonBuilder({
  id: "community.livetv-sx",
  version: "0.1.0",
  name: "LiveTV.sx Sports",
  description:
    "Live sports streams scraped from livetv.sx. Requires AceStream for most streams.",
  logo: "https://cdn.livetv861.me/img/icons/default.gif",
  background: "https://cdn.livetv861.me/img/desktop/ltvbg_1200.png",
  types: ["tv"],
  catalogs: [
    {
      type: "tv",
      id: "livetv-sports",
      name: "LiveTV.sx Sports",
      extra: [
        { name: "search", isRequired: false },
        { name: "genre", isRequired: false },
      ],
    },
  ],
  resources: ["catalog", "stream"],
  idPrefixes: ["livetv:"],
  behaviorHints: {
    configurable: false,
  },
});

// ─── Catalog handler ─────────────────────────────────────────────────────────

builder.defineCatalogHandler(async (args: { type: string; id: string; extra?: { search?: string; genre?: string } }) => {
  const events = await getCachedEvents();

  let filtered = events;

  // Filter by genre (sport)
  if (args.extra?.genre) {
    const g = args.extra.genre.toLowerCase();
    filtered = filtered.filter((e) => e.sport.toLowerCase().includes(g));
  }

  // Filter by search
  if (args.extra?.search) {
    const q = args.extra.search.toLowerCase();
    filtered = filtered.filter((e) => e.name.toLowerCase().includes(q));
  }

  const metas = filtered.map((event) => ({
    id: `livetv:${event.id}`,
    type: "tv",
    name: event.name,
    poster: event.posterUrl ?? undefined,
    genres: event.sport ? [event.sport] : [],
    description: [
      event.time ? `⏰ ${event.time}` : null,
      event.score ? `🏆 ${event.score}` : null,
      event.isLive ? "🔴 LIVE" : "⏳ Upcoming",
    ]
      .filter(Boolean)
      .join("  "),
  }));

  return { metas };
});

// ─── Stream handler ──────────────────────────────────────────────────────────

builder.defineStreamHandler(async (args: { type: string; id: string }) => {
  // id format: "livetv:371315132"
  const eventId = args.id.replace("livetv:", "");
  if (!eventId) return { streams: [] };

  const detail = await getCachedDetail(eventId);
  if (!detail) return { streams: [] };

  const resolved = resolveStreams(detail.streams);

  if (resolved.length === 0) {
    console.log(`[streams] no streams found for event ${eventId} (may not be live yet)`);
    return {
      streams: [
        {
          name: "No streams available",
          url: detail.url,
          description: "Check back closer to event start time",
          externalUrl: detail.url,
        },
      ],
    };
  }

  const streams = resolved.map((s) => ({
    name: s.name,
    url: s.url,
    description: s.description,
    behaviorHints: {
      notWebReady: s.url.startsWith("acestream://"),
    },
  }));

  console.log(`[streams] returning ${streams.length} streams for event ${eventId}`);
  return { streams };
});

// ─── Start server ─────────────────────────────────────────────────────────────

const addonInterface = builder.getInterface();

serveHTTP(addonInterface, { port: PORT }).then(({ url }: { url: string }) => {
  console.log(`\n╔══════════════════════════════════════════╗`);
  console.log(`║  LiveTV.sx Stremio Add-on is running!    ║`);
  console.log(`╠══════════════════════════════════════════╣`);
  console.log(`║  Manifest: ${url.padEnd(31)}║`);
  console.log(`║                                          ║`);
  console.log(`║  To install in Stremio:                  ║`);
  console.log(`║  1. Open Stremio                         ║`);
  console.log(`║  2. Go to Add-ons search                 ║`);
  console.log(`║  3. Paste the manifest URL above         ║`);
  console.log(`╚══════════════════════════════════════════╝\n`);

  // Warm the events cache on startup
  getCachedEvents();
});
