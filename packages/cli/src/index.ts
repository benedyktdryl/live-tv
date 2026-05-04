#!/usr/bin/env bun
import * as p from "@clack/prompts";
import {
  fetchEvents,
  fetchEventDetail,
  resolveStreamsAsync,
  bestVlcUrl,
  bestBrowserUrl,
  isAceEngineAvailable,
  categorizeEvent,
  groupByCategory,
  groupByDate,
  dayLabel,
  loadPrefs,
  savePrefs,
  CATEGORIES,
} from "@live-tv/core";
import type { LiveEvent } from "@live-tv/core";
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type SelectOption<V> = { value: V; label: string; hint?: string };

// ─── Helpers ──────────────────────────────────────────────────────────────────

function formatEvent(event: LiveEvent): string {
  const parts: string[] = [];
  if (event.time) parts.push(event.time);
  parts.push(event.name);
  if (event.score) parts.push(`[${event.score}]`);
  if (event.sport) parts.push(`(${event.sport})`);
  if (event.isLive) parts.push("🔴");
  return parts.join("  ");
}

function liveCount(events: LiveEvent[]): number {
  return events.filter((e) => e.isLive).length;
}

function sortEvents(events: LiveEvent[]): LiveEvent[] {
  return [...events].sort((a, b) => {
    if (a.isLive && !b.isLive) return -1;
    if (!a.isLive && b.isLive) return 1;
    if (a.date !== b.date) return (a.date || "9999").localeCompare(b.date || "9999");
    return a.time.localeCompare(b.time);
  });
}

async function openVlc(url: string): Promise<void> {
  const vlcPaths = [
    "/Applications/VLC.app/Contents/MacOS/VLC",
    "/usr/bin/vlc",
    "/usr/local/bin/vlc",
    "vlc",
  ];
  for (const vlc of vlcPaths) {
    try {
      const proc = Bun.spawn([vlc, url], { stdout: "ignore", stderr: "ignore", stdin: "ignore" });
      await new Promise((r) => setTimeout(r, 500));
      if (proc.exitCode === null) {
        console.log(`\n▶  Opened VLC: ${url}\n`);
        return;
      }
    } catch {
      // try next
    }
  }
  console.error("\n✗ Could not find VLC. Install it or open this URL manually:");
  console.error(`  ${url}\n`);
}

async function openBrowser(url: string): Promise<void> {
  const openers = process.platform === "darwin" ? ["open"] : ["xdg-open", "sensible-browser"];
  for (const opener of openers) {
    try {
      Bun.spawn([opener, url], { stdout: "ignore", stderr: "ignore", stdin: "ignore" });
      console.log(`\n🌐  Opened in browser: ${url}\n`);
      return;
    } catch {
      // try next
    }
  }
  console.log(`\n🌐  Open this URL in your browser:\n  ${url}\n`);
}

// ─── Non-interactive commands ─────────────────────────────────────────────────

async function cmdList(flags: { sport?: string; date?: string } = {}) {
  let events = await fetchEvents();

  if (flags.sport) {
    const q = flags.sport.toLowerCase();
    events = events.filter((e) => {
      const cat = categorizeEvent(e.sport).toLowerCase();
      return cat.includes(q) || e.sport.toLowerCase().includes(q);
    });
  }

  if (flags.date) {
    const today = new Date().toISOString().slice(0, 10);
    if (flags.date === "today") {
      events = events.filter((e) => !e.date || e.date === today);
    } else if (flags.date === "tomorrow") {
      const tomorrow = new Date(Date.now() + 86_400_000).toISOString().slice(0, 10);
      events = events.filter((e) => e.date === tomorrow);
    } else {
      events = events.filter((e) => e.date === flags.date);
    }
  }

  console.log(JSON.stringify(events, null, 2));
}

async function cmdWatch(eventId: string) {
  const detail = await fetchEventDetail(eventId);
  if (!detail) {
    console.error(`Event ${eventId} not found`);
    process.exit(1);
  }
  const vlcUrl = bestVlcUrl(detail.streams);
  if (vlcUrl) {
    await openVlc(vlcUrl);
    return;
  }
  const browserUrl = bestBrowserUrl(detail.streams);
  if (browserUrl) {
    console.log("No AceStream/YouTube found — opening web embed in browser:");
    await openBrowser(browserUrl);
    return;
  }
  console.error("No playable stream found for this event");
  process.exit(1);
}

async function cmdStreams(eventId: string) {
  const detail = await fetchEventDetail(eventId);
  if (!detail) {
    console.error(`Event ${eventId} not found`);
    process.exit(1);
  }
  const resolved = await resolveStreamsAsync(detail.streams);
  console.log(JSON.stringify(resolved, null, 2));
}

async function cmdConfig() {
  const prefs = loadPrefs();

  p.intro("LiveTV.sx — Preferences");

  const categoryNames = CATEGORIES.map((c) => c.name);

  const choice = await p.select({
    message: "Default sport category (shown first in interactive mode):",
    options: [
      { value: null, label: "(none — show all)", hint: "No preference set" },
      ...categoryNames.map((name) => ({
        value: name,
        label: `${CATEGORIES.find((c) => c.name === name)?.emoji ?? ""} ${name}`,
        hint: prefs.defaultCategory === name ? "current" : undefined,
      })),
    ],
  });

  if (p.isCancel(choice)) {
    p.cancel("Cancelled.");
    process.exit(0);
  }

  savePrefs({ ...prefs, defaultCategory: choice as string | null });
  p.outro(`Saved. Default: ${choice ?? "none"}`);
}

// ─── Interactive mode ─────────────────────────────────────────────────────────

async function pickEvent(events: LiveEvent[]): Promise<string | null> {
  if (events.length === 0) {
    p.log.warn("No events in this selection.");
    return null;
  }

  const sorted = sortEvents(events);

  const choice = await p.select({
    message: "Select an event:",
    options: sorted.map((e) => ({
      value: e.id,
      label: formatEvent(e),
    })),
  });

  if (p.isCancel(choice)) return null;
  return choice as string;
}

async function pickStream(eventId: string, aceAvailable: boolean): Promise<void> {
  const spin = p.spinner();
  spin.start("Fetching stream links…");

  let detail: Awaited<ReturnType<typeof fetchEventDetail>>;
  try {
    detail = await fetchEventDetail(eventId);
    spin.stop(detail ? `Found ${detail.streams.length} stream(s)` : "No detail found");
  } catch (err) {
    spin.stop("Failed to fetch streams");
    p.log.error(String(err));
    return;
  }

  if (!detail || detail.streams.length === 0) {
    p.log.warn("No streams available yet. Check back closer to event start time.");
    return;
  }

  const hasWebEmbeds = detail.streams.some((s) => s.type === "webplayer");
  if (hasWebEmbeds) spin.start("Extracting HLS from web embeds…");
  const resolved = await resolveStreamsAsync(detail.streams);
  if (hasWebEmbeds) spin.stop("Done");

  const streamChoice = await p.select({
    message: "Select a stream:",
    options: resolved.map((s, i) => ({
      value: i,
      label: s.isExternal ? `🌐 ${s.name}` : `▶  ${s.name}`,
      hint: s.description,
    })),
  });

  if (p.isCancel(streamChoice)) {
    p.cancel("Cancelled.");
    return;
  }

  const chosen = resolved[streamChoice as number];

  if (chosen.isExternal) {
    await openBrowser(chosen.url);
  } else if (chosen.url.startsWith("acestream://")) {
    if (!aceAvailable) {
      p.log.warn("AceStream engine not running — trying system acestream:// URI handler…");
      await openBrowser(chosen.url);
    } else {
      const hash = chosen.url.replace("acestream://", "");
      const httpUrl = `http://127.0.0.1:6878/ace/getstream?content_id=${hash}`;
      await openVlc(httpUrl);
    }
  } else {
    await openVlc(chosen.url);
  }

  p.outro("Enjoy the match!");
}

async function interactive() {
  p.intro("LiveTV.sx — Sports Stream Picker");

  const prefs = loadPrefs();
  const aceAvailable = await isAceEngineAvailable();
  if (!aceAvailable) {
    p.log.warn(
      "AceStream engine not detected at localhost:6878.\n" +
        "  Most streams require it. Start it with:\n" +
        "  docker compose up -d",
    );
  }

  const spin = p.spinner();
  spin.start("Fetching events…");
  let allEvents: LiveEvent[];
  try {
    allEvents = await fetchEvents();
    spin.stop(`Loaded ${allEvents.length} events`);
  } catch (err) {
    spin.stop("Failed to fetch events");
    p.log.error(String(err));
    process.exit(1);
  }

  if (allEvents.length === 0) {
    p.log.warn("No events found.");
    process.exit(0);
  }

  // ── Step 1: Browse mode ───────────────────────────────────────────────────

  const byCategory = groupByCategory(allEvents);
  const byDate = groupByDate(allEvents);

  // Build category options ordered: default first, then rest, then day-browse + all
  const catOptions: SelectOption<string>[] = [];

  const categoryOrder = [...byCategory.keys()];
  // Move default category to top
  if (prefs.defaultCategory && byCategory.has(prefs.defaultCategory)) {
    const idx = categoryOrder.indexOf(prefs.defaultCategory);
    if (idx > 0) {
      categoryOrder.splice(idx, 1);
      categoryOrder.unshift(prefs.defaultCategory);
    }
  }

  for (const catName of categoryOrder) {
    const events = byCategory.get(catName)!;
    const live = liveCount(events);
    const def = catName === prefs.defaultCategory;
    const emoji = CATEGORIES.find((c) => c.name === catName)?.emoji ?? "🏅";
    catOptions.push({
      value: `cat:${catName}`,
      label: `${emoji} ${catName}  (${events.length} events${live > 0 ? `, ${live} live` : ""})`,
      hint: def ? "★ your default" : undefined,
    });
  }

  // Separator-style entries for day browsing and all events
  const sortedDates = [...byDate.keys()].filter(Boolean).sort();
  catOptions.push({
    value: "day",
    label: `📅 Browse by day  (${sortedDates.length} days available)`,
  });
  catOptions.push({
    value: "all",
    label: `📋 All events  (${allEvents.length} total)`,
  });
  catOptions.push({
    value: "config",
    label: `⚙  Preferences`,
  });

  const browseChoice = await p.select({
    message: "What do you want to watch?",
    options: catOptions,
  });

  if (p.isCancel(browseChoice)) {
    p.cancel("Cancelled.");
    process.exit(0);
  }

  let filteredEvents: LiveEvent[];

  if (browseChoice === "config") {
    await cmdConfig();
    process.exit(0);
  } else if (browseChoice === "all") {
    filteredEvents = allEvents;
  } else if (browseChoice === "day") {
    // ── Step 1b: Day picker ───────────────────────────────────────────────
    const todayStr = new Date().toISOString().slice(0, 10);
    const dayOptions: SelectOption<string>[] = [
      {
        value: "all-days",
        label: `📅 All days  (${allEvents.length} events)`,
      },
      ...sortedDates.map((d) => {
        const dayEvents = byDate.get(d)!;
        const live = liveCount(dayEvents);
        const label = `${d === todayStr ? "📅 Today" : `📅 ${dayLabel(d)}`}  — ${d}`;
        return {
          value: d,
          label: `${label}  (${dayEvents.length} events${live > 0 ? `, ${live} live` : ""})`,
        };
      }),
    ];

    // Add events without parsed date under "today" label
    const undated = byDate.get("") ?? [];
    if (undated.length > 0) {
      dayOptions.splice(1, 0, {
        value: "undated",
        label: `📅 Today (live now)  (${undated.length} events)`,
      });
    }

    const dayChoice = await p.select({
      message: "Select a day:",
      options: dayOptions,
    });

    if (p.isCancel(dayChoice)) {
      p.cancel("Cancelled.");
      process.exit(0);
    }

    if (dayChoice === "all-days") {
      filteredEvents = allEvents;
    } else if (dayChoice === "undated") {
      filteredEvents = undated;
    } else {
      filteredEvents = byDate.get(dayChoice as string) ?? [];
    }

    // ── Step 1c (optional): Sport filter within the day ───────────────────
    if (filteredEvents.length > 15) {
      const dayCats = groupByCategory(filteredEvents);
      const sportOptions: SelectOption<string>[] = [
        {
          value: "all",
          label: `📋 All  (${filteredEvents.length} events)`,
        },
        ...[...dayCats.entries()].map(([name, evts]) => {
          const emoji = CATEGORIES.find((c) => c.name === name)?.emoji ?? "🏅";
          const live = liveCount(evts);
          return {
            value: name,
            label: `${emoji} ${name}  (${evts.length}${live > 0 ? `, ${live} live` : ""})`,
          };
        }),
      ];

      const sportChoice = await p.select({
        message: "Filter by sport:",
        options: sportOptions,
      });

      if (p.isCancel(sportChoice)) {
        p.cancel("Cancelled.");
        process.exit(0);
      }

      if (sportChoice !== "all") {
        filteredEvents = dayCats.get(sportChoice as string) ?? filteredEvents;
      }
    }
  } else {
    // Sport category was picked directly
    const catName = (browseChoice as string).replace("cat:", "");
    filteredEvents = byCategory.get(catName) ?? allEvents;
  }

  // ── Step 2: Event picker ──────────────────────────────────────────────────
  const eventId = await pickEvent(filteredEvents);
  if (!eventId) {
    p.cancel("Cancelled.");
    process.exit(0);
  }

  // ── Step 3: Stream picker ─────────────────────────────────────────────────
  await pickStream(eventId, aceAvailable);
}

// ─── Entry point ─────────────────────────────────────────────────────────────

const [, , command, ...args] = process.argv;

// Parse simple --flag value pairs from args
function parseFlag(flag: string): string | undefined {
  const idx = args.indexOf(flag);
  return idx !== -1 ? args[idx + 1] : undefined;
}

switch (command) {
  case "list":
    await cmdList({
      sport: parseFlag("--sport"),
      date: parseFlag("--date"),
    });
    break;
  case "watch":
    if (!args[0]) {
      console.error("Usage: livetv watch <event-id>");
      process.exit(1);
    }
    await cmdWatch(args[0]);
    break;
  case "streams":
    if (!args[0]) {
      console.error("Usage: livetv streams <event-id>");
      process.exit(1);
    }
    await cmdStreams(args[0]);
    break;
  case "config":
    await cmdConfig();
    break;
  default:
    await interactive();
}
