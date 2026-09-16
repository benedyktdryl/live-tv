import { createRequire } from "module";
import {
  fetchEvents,
  fetchEventDetail,
  resolveStreamsAsync,
  parseSourceIds,
  defaultSourceIds,
  listConnectors,
  normalizeEventId,
} from "@live-tv/core";
import type { ResolvedStream } from "@live-tv/core";

const require = createRequire(import.meta.url);
const { addonBuilder, serveHTTP } = require("stremio-addon-sdk");

const PORT = parseInt(process.env.PORT ?? "7000", 10);

const SOURCE_IDS =
  process.env.LIVE_TV_SOURCES != null
    ? parseSourceIds(process.env.LIVE_TV_SOURCES)
    : defaultSourceIds();

const ID_PREFIXES = SOURCE_IDS.map((id) => `${id}:`);

// ─── TTL cache ────────────────────────────────────────────────────────────────

const EVENTS_TTL_MS = 5 * 60 * 1000;

let eventsCache: Awaited<ReturnType<typeof fetchEvents>> = [];
let eventsCachedAt = 0;

async function getCachedEvents() {
  if (Date.now() - eventsCachedAt < EVENTS_TTL_MS) return eventsCache;
  try {
    eventsCache = await fetchEvents(SOURCE_IDS);
    eventsCachedAt = Date.now();
    console.log(`[cache] refreshed ${eventsCache.length} events from ${SOURCE_IDS.join(", ")}`);
  } catch (err) {
    console.error("[cache] failed to refresh events:", err);
  }
  return eventsCache;
}

const detailCache = new Map<
  string,
  { data: Awaited<ReturnType<typeof fetchEventDetail>>; at: number }
>();
const DETAIL_TTL_MS = 2 * 60 * 1000;

async function getCachedDetail(compositeId: string) {
  const cached = detailCache.get(compositeId);
  if (cached && Date.now() - cached.at < DETAIL_TTL_MS) return cached.data;
  const data = await fetchEventDetail(compositeId);
  if (data) detailCache.set(compositeId, { data, at: Date.now() });
  return data;
}

const sourceNames = new Map(listConnectors().map((c) => [c.id, c.displayName]));

// ─── Addon manifest ──────────────────────────────────────────────────────────

const builder = new addonBuilder({
  id: "community.live-tv-multi",
  version: "0.2.0",
  name: "live-tv Multi-Source Sports",
  description:
    "Live sports from livetv.sx, BuffStreams, DaddyLive (DLHD), and Strumyk. AceStream where available; web embeds open in browser.",
  logo: "https://cdn.livetv861.me/img/icons/default.gif",
  background: "https://cdn.livetv861.me/img/desktop/ltvbg_1200.png",
  types: ["tv"],
  catalogs: [
    {
      type: "tv",
      id: "live-tv-sports",
      name: "live-tv Sports",
      extra: [
        { name: "search", isRequired: false },
        { name: "genre", isRequired: false },
      ],
    },
  ],
  resources: ["catalog", "stream"],
  idPrefixes: ID_PREFIXES,
  behaviorHints: {
    configurable: false,
  },
});

// ─── Catalog handler ─────────────────────────────────────────────────────────

builder.defineCatalogHandler(
  async (args: { type: string; id: string; extra?: { search?: string; genre?: string } }) => {
    const events = await getCachedEvents();

    let filtered = events;

    if (args.extra?.genre) {
      const g = args.extra.genre.toLowerCase();
      if (SOURCE_IDS.includes(g)) {
        filtered = filtered.filter((e) => e.source === g);
      } else {
        filtered = filtered.filter((e) => e.sport.toLowerCase().includes(g));
      }
    }

    if (args.extra?.search) {
      const q = args.extra.search.toLowerCase();
      filtered = filtered.filter(
        (e) =>
          e.name.toLowerCase().includes(q) ||
          e.sport.toLowerCase().includes(q) ||
          e.source.toLowerCase().includes(q),
      );
    }

    const metas = filtered.map((event) => ({
      id: event.id,
      type: "tv",
      name: event.name,
      poster: event.posterUrl ?? undefined,
      genres: [event.sport, sourceNames.get(event.source) ?? event.source].filter(Boolean),
      description: [
        `[${sourceNames.get(event.source) ?? event.source}]`,
        event.isLive ? "🔴 LIVE" : event.date ? `📅 ${event.date}` : "⏳ Upcoming",
        event.time ? `⏰ ${event.time}` : null,
        event.score ? `🏆 ${event.score}` : null,
      ]
        .filter(Boolean)
        .join("  "),
    }));

    return { metas };
  },
);

// ─── Stream handler ──────────────────────────────────────────────────────────

builder.defineStreamHandler(async (args: { type: string; id: string }) => {
  const compositeId = normalizeEventId(args.id);
  if (!compositeId.includes(":")) return { streams: [] };

  const detail = await getCachedDetail(compositeId);
  if (!detail) return { streams: [] };

  const resolved = await resolveStreamsAsync(detail.streams);

  if (resolved.length === 0) {
    console.log(`[streams] no streams found for event ${compositeId}`);
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

  const streams = resolved.map((s: ResolvedStream) => {
    if (s.isExternal) {
      return {
        name: s.name,
        description: s.description,
        externalUrl: s.url,
      };
    }
    return {
      name: s.name,
      url: s.url,
      description: s.description,
      behaviorHints: {
        notWebReady: s.url.startsWith("acestream://"),
      },
    };
  });

  console.log(`[streams] returning ${streams.length} streams for ${compositeId}`);
  return { streams };
});

// ─── Start server ─────────────────────────────────────────────────────────────

const addonInterface = builder.getInterface();

serveHTTP(addonInterface, { port: PORT }).then(({ url }: { url: string }) => {
  console.log(`\n╔══════════════════════════════════════════╗`);
  console.log(`║  live-tv Stremio Add-on is running!      ║`);
  console.log(`╠══════════════════════════════════════════╣`);
  console.log(`║  Sources: ${SOURCE_IDS.join(", ").padEnd(28)}║`);
  console.log(`║  Manifest: ${url.padEnd(31)}║`);
  console.log(`╚══════════════════════════════════════════╝\n`);

  getCachedEvents();
});
