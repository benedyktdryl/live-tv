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
// @clack/prompts exports Option<V> but not under that name publicly, so define locally
type SelectOption<V> = { value: V; label: string; hint?: string };

// ─── Filter presets ───────────────────────────────────────────────────────────

interface FilterPreset {
  /** Category name ("Football", "Tennis", …) or "all" */
  sport: string;
  /** ISO date "YYYY-MM-DD", "all", or "undated" */
  day: string;
  /** Optional free-text search query */
  search?: string;
}

function encodePreset(preset: FilterPreset): string {
  return Buffer.from(JSON.stringify(preset)).toString("base64url");
}

function decodePreset(code: string): FilterPreset | null {
  try {
    const raw = Buffer.from(code, "base64url").toString("utf8");
    const obj = JSON.parse(raw);
    if (typeof obj.sport !== "string" || typeof obj.day !== "string") return null;
    return obj as FilterPreset;
  } catch {
    return null;
  }
}

function describePreset(preset: FilterPreset): string {
  const parts: string[] = [];
  if (preset.sport !== "all") parts.push(preset.sport);
  if (preset.day === "all") {
    parts.push("all days");
  } else if (preset.day === "undated") {
    parts.push("live now");
  } else {
    parts.push(dayLabel(preset.day));
  }
  if (preset.search) parts.push(`"${preset.search}"`);
  return parts.join(" · ");
}

/** Apply a FilterPreset to an event array and return the matching subset. */
function applyPreset(events: LiveEvent[], preset: FilterPreset): LiveEvent[] {
  let result = events;

  if (preset.sport !== "all") {
    result = groupByCategory(result).get(preset.sport) ?? [];
  }

  if (preset.day === "undated") {
    result = groupByDate(result).get("") ?? [];
  } else if (preset.day !== "all") {
    result = groupByDate(result).get(preset.day) ?? [];
  }

  if (preset.search) {
    const q = preset.search.toLowerCase();
    result = result.filter(
      (e) => e.name.toLowerCase().includes(q) || e.sport.toLowerCase().includes(q),
    );
  }

  return result;
}

// ─── Help ─────────────────────────────────────────────────────────────────────

function cmdHelp() {
  const c = {
    bold: (s: string) => `\x1b[1m${s}\x1b[0m`,
    dim: (s: string) => `\x1b[2m${s}\x1b[0m`,
    cyan: (s: string) => `\x1b[36m${s}\x1b[0m`,
    green: (s: string) => `\x1b[32m${s}\x1b[0m`,
    yellow: (s: string) => `\x1b[33m${s}\x1b[0m`,
  };

  console.log(`
${c.bold("LiveTV.sx")}  ${c.dim("— ad-free sports streaming CLI")}

${c.bold("USAGE")}
  ${c.cyan("bun run cli")}                              Interactive picker
  ${c.cyan("bun run cli --preset")} ${c.yellow("<code>")}              Replay saved filters, skip to event list
  ${c.cyan("bun run cli list")}                         Print all events as JSON
  ${c.cyan("bun run cli list --sport")} ${c.yellow("<category>")}      Filter by sport category
  ${c.cyan("bun run cli list --date")}  ${c.yellow("<day>")}           Filter by day
  ${c.cyan("bun run cli watch")} ${c.yellow("<event-id>")}             Open best stream in VLC
  ${c.cyan("bun run cli streams")} ${c.yellow("<event-id>")}           Print resolved stream URLs as JSON
  ${c.cyan("bun run cli config")}                       Set default sport (saved to prefs)
  ${c.cyan("bun run cli help")}                         Show this help

${c.bold("LIST FLAGS")}
  ${c.yellow("--sport")} ${c.dim("<category>")}   Match category name or raw sport string (case-insensitive)
                   ${c.dim("Examples:")} --sport football  --sport tennis  --sport mlb
  ${c.yellow("--date")}  ${c.dim("<day>")}        today | tomorrow | YYYY-MM-DD
                   ${c.dim("Examples:")} --date today  --date tomorrow  --date 2026-05-06
  ${c.dim("Flags can be combined:")}  bun run cli list --sport football --date today

${c.bold("SPORT CATEGORIES")}
  ${CATEGORIES.map((c2) => `${c2.emoji} ${c2.name}`).join("   ")}
  🏅 Other

${c.bold("INTERACTIVE MODE")}  ${c.dim("(no arguments)")}
  ${c.dim("Step 1")}  Sport filter  — choose a category or All sports
  ${c.dim("Step 2")}  Day filter    — choose Today / Tomorrow / … or All days
  ${c.dim("Step 3")}  Search        — optional name filter (shown when >100 events match)
  ${c.dim("Step 4")}  Event list    — live events shown first, then sorted by time
  ${c.dim("Step 5")}  Stream picker — AceStream → VLC, YouTube → VLC, web embed → browser
  ${c.dim("tip:")} After filtering, a ${c.yellow("--preset")} code is printed — paste it next time to skip filters.
  ${c.dim("tip:")} Run ${c.cyan("bun run cli config")} to set a default sport that is pre-selected.

${c.bold("PRESETS")}
  After any interactive session the CLI prints a ${c.yellow("--preset")} code encoding your filters.
  Re-run it to jump straight to the filtered event list with fresh event data:
    ${c.dim("bun run cli --preset eyJzcG9ydCI6IkZvb3RiYWxsIiwiZGF5IjoiYWxsIn0")}
  The preset contains: sport · day · search query (all optional).
  Dates are stored as ISO strings (${c.yellow("YYYY-MM-DD")}); use ${c.yellow('"all"')} for any day.

${c.bold("STREAM PRIORITY")}
  1. ${c.green("AceStream")}   Best quality. Needs engine: ${c.cyan("docker compose up -d")}
  2. ${c.green("YouTube")}     Direct HLS in VLC
  3. ${c.green("Web embed")}   HLS extracted where possible, otherwise opens in browser

${c.bold("ACESTREAM SETUP")}
  ${c.dim("Via Docker (recommended):")}
    docker compose up -d
  ${c.dim("Manual:")}
    https://acestream.org

${c.bold("ENVIRONMENT")}
  ${c.yellow("LIVETV_BASE_URL")}    Override scrape base URL  ${c.dim("(default: https://livetv.sx)")}
  ${c.yellow("ACE_ENGINE_HOST")}    AceStream engine host     ${c.dim("(default: 127.0.0.1)")}
  ${c.yellow("ACE_ENGINE_PORT")}    AceStream engine port     ${c.dim("(default: 6878)")}
`);
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function formatEvent(event: LiveEvent): string {
  const parts: string[] = [];
  if (event.isLive) {
    parts.push("🔴");
  } else if (event.date) {
    parts.push(dayLabel(event.date));
  }
  if (event.time) parts.push(event.time);
  parts.push(event.name);
  if (event.score) parts.push(`[${event.score}]`);
  if (event.sport) parts.push(`(${event.sport})`);
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

  const choice = await p.select({
    message: "Default sport category (shown first in interactive mode):",
    options: [
      { value: null, label: "(none — show all sports)", hint: "No preference set" },
      ...CATEGORIES.map(({ name, emoji }) => ({
        value: name,
        label: `${emoji} ${name}`,
        hint: prefs.defaultCategory === name ? "current default" : undefined,
      })),
    ],
  });

  if (p.isCancel(choice)) {
    p.cancel("Cancelled.");
    process.exit(0);
  }

  savePrefs({ ...prefs, defaultCategory: choice as string | null });
  p.outro(`Saved. Default sport: ${choice ?? "none"}`);
}

// ─── Interactive helpers ───────────────────────────────────────────────────────

/** Ask the user to pick a sport category. Returns category name, "all", or "config". */
async function pickSport(
  allEvents: LiveEvent[],
  prefs: ReturnType<typeof loadPrefs>,
): Promise<string | null> {
  const byCategory = groupByCategory(allEvents);

  const categoryOrder = [...byCategory.keys()];
  if (prefs.defaultCategory && byCategory.has(prefs.defaultCategory)) {
    const idx = categoryOrder.indexOf(prefs.defaultCategory);
    if (idx > 0) {
      categoryOrder.splice(idx, 1);
      categoryOrder.unshift(prefs.defaultCategory);
    }
  }

  const options: SelectOption<string>[] = [
    {
      value: "all",
      label: `📋 All sports  (${allEvents.length} events, ${liveCount(allEvents)} live)`,
    },
    ...categoryOrder.map((catName) => {
      const events = byCategory.get(catName)!;
      const live = liveCount(events);
      const emoji = CATEGORIES.find((c) => c.name === catName)?.emoji ?? "🏅";
      const isDefault = catName === prefs.defaultCategory;
      return {
        value: catName,
        label: `${emoji} ${catName}  (${events.length} events${live > 0 ? `, ${live} live` : ""})`,
        hint: isDefault ? "★ your default" : undefined,
      };
    }),
    { value: "config", label: "⚙  Preferences", hint: "set a default sport" },
  ];

  const choice = await p.select({ message: "Filter by sport:", options });
  if (p.isCancel(choice)) return null;
  return choice as string;
}

/** Ask the user to pick a day. Returns ISO date string, "all", "undated", or null on cancel. */
async function pickDay(events: LiveEvent[]): Promise<string | null> {
  const byDate = groupByDate(events);
  const todayStr = new Date().toISOString().slice(0, 10);
  const sortedDates = [...byDate.keys()].filter(Boolean).sort();

  const options: SelectOption<string>[] = [
    {
      value: "all",
      label: `📅 All days  (${events.length} events, ${liveCount(events)} live)`,
    },
  ];

  const undated = byDate.get("") ?? [];
  if (undated.length > 0) {
    options.push({
      value: "undated",
      label: `📅 Today — live now  (${undated.length} events)`,
    });
  }

  for (const d of sortedDates) {
    const dayEvents = byDate.get(d)!;
    const live = liveCount(dayEvents);
    const isToday = d === todayStr;
    const label = isToday ? `📅 Today  — ${d}` : `📅 ${dayLabel(d)}  — ${d}`;
    options.push({
      value: d,
      label: `${label}  (${dayEvents.length} events${live > 0 ? `, ${live} live` : ""})`,
    });
  }

  const choice = await p.select({ message: "Filter by day:", options });
  if (p.isCancel(choice)) return null;
  return choice as string;
}

/**
 * Optional text search when the list is large.
 * Returns { events, query } — null on cancel.
 */
async function maybeSearch(
  events: LiveEvent[],
  threshold = 100,
): Promise<{ events: LiveEvent[]; query: string } | null> {
  if (events.length <= threshold) return { events, query: "" };

  const input = await p.text({
    message: `${events.length} events — search by name or sport (leave blank to show all):`,
    placeholder: "e.g. Premier League or Manchester",
  });
  if (p.isCancel(input)) return null;
  const q = (input ?? "").trim();
  if (!q) return { events, query: "" };

  return {
    events: events.filter(
      (e) =>
        e.name.toLowerCase().includes(q.toLowerCase()) ||
        e.sport.toLowerCase().includes(q.toLowerCase()),
    ),
    query: q,
  };
}

async function pickEvent(events: LiveEvent[]): Promise<string | null> {
  if (events.length === 0) {
    p.log.warn("No events match the selected filters.");
    return null;
  }

  const sorted = sortEvents(events);
  const choice = await p.select({
    message: `Select an event  (${sorted.length} shown):`,
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

// Shared startup: check AceStream + fetch events
async function startup(): Promise<{ aceAvailable: boolean; allEvents: LiveEvent[] }> {
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

  return { aceAvailable, allEvents };
}

// ─── Interactive mode ─────────────────────────────────────────────────────────

async function runWithPreset(preset: FilterPreset): Promise<void> {
  p.intro(`LiveTV.sx  —  ${describePreset(preset)}`);

  const { aceAvailable, allEvents } = await startup();
  const filtered = applyPreset(allEvents, preset);

  if (filtered.length === 0) {
    p.log.warn(
      "No events match this preset. The schedule may have changed.\n" +
        "  Run without --preset to browse fresh events.",
    );
    process.exit(0);
  }

  // Show the preset code again so the user can copy it easily
  p.log.info(
    `💾 Preset  ${describePreset(preset)}\n` + `   bun run cli --preset ${encodePreset(preset)}`,
  );

  const eventId = await pickEvent(filtered);
  if (!eventId) {
    p.cancel("Cancelled.");
    process.exit(0);
  }

  await pickStream(eventId, aceAvailable);
}

async function interactive(): Promise<void> {
  p.intro("LiveTV.sx — Sports Stream Picker");

  const prefs = loadPrefs();
  const { aceAvailable, allEvents } = await startup();

  // ── Step 1: Sport filter ──────────────────────────────────────────────────

  const sportChoice = await pickSport(allEvents, prefs);
  if (!sportChoice) {
    p.cancel("Cancelled.");
    process.exit(0);
  }
  if (sportChoice === "config") {
    await cmdConfig();
    process.exit(0);
  }

  const sportFiltered =
    sportChoice === "all" ? allEvents : (groupByCategory(allEvents).get(sportChoice) ?? allEvents);

  // ── Step 2: Day filter ────────────────────────────────────────────────────

  const dayChoice = await pickDay(sportFiltered);
  if (!dayChoice) {
    p.cancel("Cancelled.");
    process.exit(0);
  }

  let filtered: LiveEvent[];
  if (dayChoice === "all") {
    filtered = sportFiltered;
  } else if (dayChoice === "undated") {
    filtered = groupByDate(sportFiltered).get("") ?? [];
  } else {
    filtered = groupByDate(sportFiltered).get(dayChoice) ?? [];
  }

  // ── Step 3: Optional search ───────────────────────────────────────────────

  const searchResult = await maybeSearch(filtered);
  if (!searchResult) {
    p.cancel("Cancelled.");
    process.exit(0);
  }
  filtered = searchResult.events;

  // ── Preset code ───────────────────────────────────────────────────────────

  const preset: FilterPreset = {
    sport: sportChoice,
    day: dayChoice,
    ...(searchResult.query ? { search: searchResult.query } : {}),
  };
  p.log.info(`💾 Save as preset:\n   bun run cli --preset ${encodePreset(preset)}`);

  // ── Step 4: Event picker ──────────────────────────────────────────────────

  const eventId = await pickEvent(filtered);
  if (!eventId) {
    p.cancel("Cancelled.");
    process.exit(0);
  }

  // ── Step 5: Stream picker ─────────────────────────────────────────────────

  await pickStream(eventId, aceAvailable);
}

// ─── Entry point ─────────────────────────────────────────────────────────────

const [, , command, ...args] = process.argv;

function parseFlag(flag: string): string | undefined {
  const idx = args.indexOf(flag);
  return idx !== -1 ? args[idx + 1] : undefined;
}

// Handle --preset / --help / -h as flags on the default command
if (command === "--preset" && args[0]) {
  const preset = decodePreset(args[0]);
  if (!preset) {
    console.error("Invalid preset code. Run `bun run cli help` for usage.");
    process.exit(1);
  }
  await runWithPreset(preset);
} else if (command === "--help" || command === "-h") {
  cmdHelp();
} else {
  switch (command) {
    case "list":
      await cmdList({
        sport: parseFlag("--sport"),
        date: parseFlag("--date"),
      });
      break;
    case "watch":
      if (!args[0]) {
        console.error("Usage: livetv watch <event-id>\nRun `livetv help` for all commands.");
        process.exit(1);
      }
      await cmdWatch(args[0]);
      break;
    case "streams":
      if (!args[0]) {
        console.error("Usage: livetv streams <event-id>\nRun `livetv help` for all commands.");
        process.exit(1);
      }
      await cmdStreams(args[0]);
      break;
    case "config":
      await cmdConfig();
      break;
    case "help":
      cmdHelp();
      break;
    default:
      await interactive();
  }
}
