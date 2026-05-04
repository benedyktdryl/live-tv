/**
 * Sport categorisation and user preferences.
 *
 * The livetv.sx sport field is a compound string like "England. Premier League"
 * or "WTA. Rome. Qualification". We map these to a handful of top-level
 * categories using keyword patterns — good enough for quick filtering without
 * a server-side taxonomy.
 *
 * Rule order matters: more specific patterns (Tennis, Baseball, Hockey …) come
 * before the broad Football catch-all so they win first.
 */

import os from "os";
import path from "path";
import type { LiveEvent } from "./types.js";

// ─── Category definitions ─────────────────────────────────────────────────────

export interface CategoryDef {
  name: string;
  emoji: string;
  /** Returns true if the sport string belongs to this category */
  test: (sport: string) => boolean;
}

const lc = (s: string) => s.toLowerCase();

export const CATEGORIES: CategoryDef[] = [
  {
    name: "Football",
    emoji: "⚽",
    test: (s) => {
      const x = lc(s);
      // Explicit non-football first
      if (/\b(atp|wta)\b/.test(x)) return false;
      if (/\bmlb\b/.test(x)) return false;
      if (/\b(nhl|khl|ahl|vhl|mhl|pwhl|echl)\b/.test(x)) return false;
      if (/\b(nba|euroleague|vtb united|bsn|pba|cba|lkl|nbb|korisliiga)\b/.test(x)) return false;
      if (/\behf\b/.test(x)) return false;
      if (/\b(odi|t20|county championship|one.day cup|icc)\b/.test(x)) return false;
      if (/\bsnooker\b/.test(x)) return false;
      if (/\bmodus\b/.test(x)) return false;
      if (/finland.*liiga/.test(x)) return false; // Finnish ice hockey
      // Football keywords
      return /\b(league|liga|cup|copa|premier|primera|bundesliga|serie [ab]\b|eredivisie|ekstraklasa|superliga|ligue|premiership|allsvenskan|eliteserien|veikkausliiga|a lyga|meistriliiga|virsliga|primeira|pro league|j league|k.league|mls|champions|libertadores|sudamericana|concacaf|afc|usl|friendly|national teams|euro|world cup)\b/.test(
        x,
      );
    },
  },
  {
    name: "Tennis",
    emoji: "🎾",
    test: (s) => /\b(atp|wta|tennis|davis cup|billie jean|grand slam)\b/.test(lc(s)),
  },
  {
    name: "Basketball",
    emoji: "🏀",
    test: (s) =>
      /\b(nba|euroleague|vtb united|bsn|pba|cba|lkl|nbb|korisliiga|adriatic league|bbl|bnl|lnb|liganba|ncaa basketball|fiba)\b/.test(
        lc(s),
      ),
  },
  {
    name: "Ice Hockey",
    emoji: "🏒",
    test: (s) => {
      const x = lc(s);
      return (
        /\b(nhl|khl|ahl|vhl|mhl|pwhl|echl|ushl|shl|del|liiga)\b/.test(x) ||
        /finland.*liiga/.test(x) ||
        /extraliga/.test(x) // Czech/Slovak ice hockey
      );
    },
  },
  {
    name: "Baseball",
    emoji: "⚾",
    test: (s) => /\bmlb\b/.test(lc(s)),
  },
  {
    name: "Cricket",
    emoji: "🏏",
    test: (s) =>
      /\b(odi|t20|county championship|one.day cup|icc|bbl|big bash|ipl|test match)\b/.test(lc(s)),
  },
  {
    name: "Handball",
    emoji: "🤾",
    test: (s) => /\behf\b/.test(lc(s)),
  },
  {
    name: "Snooker/Darts",
    emoji: "🎱",
    test: (s) => /\b(snooker|modus|darts|pdc|bdo)\b/.test(lc(s)),
  },
];

/** Maps a sport string to a top-level category name, or "Other". */
export function categorizeEvent(sport: string): string {
  for (const cat of CATEGORIES) {
    if (cat.test(sport)) return cat.name;
  }
  return "Other";
}

/** Group events by top-level category, preserving the CATEGORIES order. */
export function groupByCategory(events: LiveEvent[]): Map<string, LiveEvent[]> {
  const map = new Map<string, LiveEvent[]>();
  for (const cat of [...CATEGORIES.map((c) => c.name), "Other"]) {
    map.set(cat, []);
  }
  for (const e of events) {
    const cat = categorizeEvent(e.sport);
    map.get(cat)!.push(e);
  }
  // Remove empty categories
  for (const [k, v] of map) {
    if (v.length === 0) map.delete(k);
  }
  return map;
}

/**
 * Group events by ISO date string (YYYY-MM-DD).
 * Events without a date go under "" (treat as today by the caller).
 */
export function groupByDate(events: LiveEvent[]): Map<string, LiveEvent[]> {
  const map = new Map<string, LiveEvent[]>();
  for (const e of events) {
    const key = e.date ?? "";
    if (!map.has(key)) map.set(key, []);
    map.get(key)!.push(e);
  }
  return map;
}

/** Human-readable day label for a date string. */
export function dayLabel(dateStr: string): string {
  if (!dateStr) return "Today";
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const d = new Date(dateStr + "T00:00:00");
  const diffDays = Math.round((d.getTime() - today.getTime()) / 86_400_000);
  if (diffDays === 0) return "Today";
  if (diffDays === 1) return "Tomorrow";
  return d.toLocaleDateString("en-US", { weekday: "long", month: "short", day: "numeric" });
}

// ─── User preferences ─────────────────────────────────────────────────────────

export interface Prefs {
  /** Default sport category shown at the top of the category list */
  defaultCategory: string | null;
}

const DEFAULT_PREFS: Prefs = { defaultCategory: null };

function prefsPath(): string {
  return path.join(os.homedir(), ".config", "live-tv", "prefs.json");
}

export function loadPrefs(): Prefs {
  try {
    const raw = require("fs").readFileSync(prefsPath(), "utf8");
    return { ...DEFAULT_PREFS, ...JSON.parse(raw) };
  } catch {
    return { ...DEFAULT_PREFS };
  }
}

export function savePrefs(prefs: Prefs): void {
  const p = prefsPath();
  require("fs").mkdirSync(path.dirname(p), { recursive: true });
  require("fs").writeFileSync(p, JSON.stringify(prefs, null, 2));
}
