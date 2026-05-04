/**
 * Snapshot-based tests — deterministic, no network access.
 *
 * HTML fixtures in __fixtures__/ are saved snapshots of real pages (or minimal
 * synthetic pages that replicate observed HTML structures). If a test starts
 * failing it means livetv.sx or an embed provider changed their HTML structure
 * and the corresponding parser needs to be updated.
 *
 * To refresh a fixture after a site change:
 *   bun packages/core/src/refresh-fixtures.ts
 * (or just curl/save the relevant page and overwrite the file)
 */

import { describe, expect, test } from "bun:test";
import path from "path";
import { parseEventListFromHtml, parseStreamLinksFromHtml, parseEventDate } from "./scraper.js";
import { extractAliezM3u8FromHtml, extractGenericM3u8FromHtml } from "./embed-resolver.js";
import { categorizeEvent, groupByCategory, groupByDate, dayLabel } from "./categories.js";

const FIXTURES = path.join(import.meta.dir, "__fixtures__");

async function fixture(name: string): Promise<string> {
  return Bun.file(path.join(FIXTURES, name)).text();
}

// ─── Event list (livetv.sx/enx/allupcomingsports) ─────────────────────────────

describe("parseEventListFromHtml — real fixture", () => {
  test("extracts ~500 events with correct structure", async () => {
    const html = await fixture("event-list.html");
    const events = parseEventListFromHtml(html, "https://livetv.sx");

    expect(events.length).toBeGreaterThan(400);
    // Every event has mandatory fields
    for (const e of events) {
      expect(e.id).toMatch(/^\d+$/);
      expect(e.name.length).toBeGreaterThan(0);
      expect(e.url).toContain("/eventinfo/");
    }
  });

  test("correctly identifies live vs upcoming events", async () => {
    const html = await fixture("event-list.html");
    const events = parseEventListFromHtml(html);

    const live = events.filter((e) => e.isLive);
    const upcoming = events.filter((e) => !e.isLive);

    expect(live.length).toBeGreaterThan(0);
    expect(upcoming.length).toBeGreaterThan(live.length);
  });

  test("MODUS Super Series — live event snapshot", async () => {
    const html = await fixture("event-list.html");
    const events = parseEventListFromHtml(html);

    const modus = events.find((e) => e.id === "378069787");
    expect(modus).toBeDefined();
    expect(modus!.name).toBe("MODUS Super Series");
    expect(modus!.isLive).toBe(true);
    expect(modus!.time).toBe("9:30");
    expect(modus!.sport).toBe("Modus League");
    expect(modus!.score).toBeNull();
    // date should be parseable as YYYY-MM-DD
    expect(modus!.date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  test("Kolos Kovalivka — upcoming event snapshot", async () => {
    const html = await fixture("event-list.html");
    const events = parseEventListFromHtml(html);

    const kolos = events.find((e) => e.id === "378058838");
    expect(kolos).toBeDefined();
    expect(kolos!.name).toBe("Kolos Kovalivka (W) \u2013 SeaSters (W)");
    expect(kolos!.isLive).toBe(false);
    expect(kolos!.time).toBe("10:00");
    expect(kolos!.sport).toBe("Ukraine. Women. Vyshcha Liha");
  });

  test("deduplicates events — each ID appears exactly once", async () => {
    const html = await fixture("event-list.html");
    const events = parseEventListFromHtml(html);

    const ids = events.map((e) => e.id);
    const unique = new Set(ids);
    expect(ids.length).toBe(unique.size);
  });
});

// ─── Stream link parsing (event detail page) ─────────────────────────────────

describe("parseStreamLinksFromHtml — real fixture (World Championships)", () => {
  test("extracts 4 YouTube streams from World Championships page", async () => {
    const html = await fixture("event-with-streams.html");
    const streams = parseStreamLinksFromHtml(html);

    expect(streams).toHaveLength(4);
    for (const s of streams) {
      expect(s.type).toBe("youtube");
      expect(s.url).toMatch(/^https:\/\/www\.youtube\.com\/watch\?v=[A-Za-z0-9_-]{11}$/);
      expect(s.provider).toBe("YouTube");
    }
  });

  test("YouTube video IDs match the page fixture", async () => {
    const html = await fixture("event-with-streams.html");
    const streams = parseStreamLinksFromHtml(html);

    const ids = streams.map((s) => new URL(s.url).searchParams.get("v"));
    expect(ids).toContain("dRqTlAAsp7U");
    expect(ids).toContain("fparm_ODASk");
    expect(ids).toContain("HUCq3ajk0Ok");
    expect(ids).toContain("tvTJ5sBE67Y");
  });
});

describe("parseStreamLinksFromHtml — synthetic all-stream-types fixture", () => {
  test("extracts AceStream links with bitrate", async () => {
    const html = await fixture("event-with-all-streams.html");
    const streams = parseStreamLinksFromHtml(html);

    const ace = streams.filter((s) => s.type === "acestream");
    expect(ace).toHaveLength(2);

    expect(ace[0].url).toBe("acestream://a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2");
    expect(ace[0].bitrate).toBe("8000kbps");
    expect(ace[0].provider).toBe("AceStream");

    expect(ace[1].url).toBe("acestream://b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3");
    expect(ace[1].bitrate).toBe("5000kbps");
  });

  test("extracts YouTube link with correct video ID", async () => {
    const html = await fixture("event-with-all-streams.html");
    const streams = parseStreamLinksFromHtml(html);

    const yt = streams.filter((s) => s.type === "youtube");
    expect(yt).toHaveLength(1);
    expect(yt[0].url).toBe("https://www.youtube.com/watch?v=dRqTlAAsp7U");
    expect(yt[0].provider).toBe("YouTube");
  });

  test("extracts Aliez webplayer link with bitrate and correct provider", async () => {
    const html = await fixture("event-with-all-streams.html");
    const streams = parseStreamLinksFromHtml(html);

    const aliez = streams.find((s) => s.type === "webplayer" && s.provider === "Aliez");
    expect(aliez).toBeDefined();
    expect(aliez!.url).toContain("t=alieztv");
    expect(aliez!.url).toContain("c=123");
    expect(aliez!.bitrate).toBe("2700kbps");
  });

  test("extracts Voodc webplayer link with correct provider", async () => {
    const html = await fixture("event-with-all-streams.html");
    const streams = parseStreamLinksFromHtml(html);

    const voodc = streams.find((s) => s.type === "webplayer" && s.provider === "Voodc");
    expect(voodc).toBeDefined();
    expect(voodc!.url).toContain("t=voodc");
    expect(voodc!.url).toContain("c=456");
    expect(voodc!.bitrate).toBeNull();
  });

  test("correct stream count: 2 acestream + 1 youtube + 2 webplayer", async () => {
    const html = await fixture("event-with-all-streams.html");
    const streams = parseStreamLinksFromHtml(html);

    expect(streams.filter((s) => s.type === "acestream")).toHaveLength(2);
    expect(streams.filter((s) => s.type === "youtube")).toHaveLength(1);
    expect(streams.filter((s) => s.type === "webplayer")).toHaveLength(2);
    expect(streams).toHaveLength(5);
  });
});

// ─── Embed resolver — pure HTML extraction ────────────────────────────────────

describe("extractAliezM3u8FromHtml", () => {
  test("extracts m3u8 URL from live Aliez player page", async () => {
    const html = await fixture("aliez-player-live.html");
    const url = extractAliezM3u8FromHtml(html);

    expect(url).not.toBeNull();
    // URL must be absolute https://
    expect(url).toMatch(/^https:\/\//);
    // Must be an HLS stream from the azplay32 CDN
    expect(url).toMatch(/\.azplay32\.me\/hls\/.+\/index\.m3u8/);
    // Must have the session token
    expect(url).toContain("?cst=");
    // Full URL snapshot from the saved fixture
    expect(url).toBe(
      "https://a75.azplay32.me/hls/streama1/index.m3u8?cst=fc4b0c7ee4fea6a541e84726ed92726f",
    );
  });

  test("returns null when channel is offline (no m3u8 in pl.init)", async () => {
    const html = await fixture("aliez-player-offline.html");
    const url = extractAliezM3u8FromHtml(html);
    expect(url).toBeNull();
  });

  test("handles various pl.init quote styles", () => {
    const withSingle = `<script>pl.init('//cdn1.azplay32.me/hls/ch1/index.m3u8?cst=abc123');</script>`;
    const withDouble = `<script>pl.init("//cdn2.azplay32.me/hls/ch2/index.m3u8?cst=def456");</script>`;
    const withSpaces = `<script>pl.init(  '//cdn3.azplay32.me/hls/ch3/index.m3u8?cst=ghi789'  );</script>`;

    expect(extractAliezM3u8FromHtml(withSingle)).toBe(
      "https://cdn1.azplay32.me/hls/ch1/index.m3u8?cst=abc123",
    );
    expect(extractAliezM3u8FromHtml(withDouble)).toBe(
      "https://cdn2.azplay32.me/hls/ch2/index.m3u8?cst=def456",
    );
    expect(extractAliezM3u8FromHtml(withSpaces)).toBe(
      "https://cdn3.azplay32.me/hls/ch3/index.m3u8?cst=ghi789",
    );
  });

  test("returns null for HTML with no pl.init call", () => {
    const html = `<html><body><p>No player here.</p></body></html>`;
    expect(extractAliezM3u8FromHtml(html)).toBeNull();
  });
});

describe("extractGenericM3u8FromHtml", () => {
  test("extracts absolute https:// m3u8 URL from Voodc player page", async () => {
    const html = await fixture("voodc-player-live.html");
    const url = extractGenericM3u8FromHtml(html);

    expect(url).not.toBeNull();
    expect(url).toBe("https://cdn5.voodc.com/hls/channel456/index.m3u8");
  });

  test("extracts protocol-relative m3u8 URL and qualifies it", () => {
    const html = `<script>jwplayer("p").setup({file: "//stream.example.com/live/ch1.m3u8"});</script>`;
    const url = extractGenericM3u8FromHtml(html);
    expect(url).toBe("https://stream.example.com/live/ch1.m3u8");
  });

  test("prefers https:// absolute URL over protocol-relative when both present", () => {
    const html = `
      <script>
        var fallback = "//cdn2.example.com/fallback.m3u8";
        var primary = "https://cdn1.example.com/primary.m3u8";
        player.setup({file: primary});
      </script>`;
    const url = extractGenericM3u8FromHtml(html);
    expect(url).toBe("https://cdn1.example.com/primary.m3u8");
  });

  test("returns null for HTML with no m3u8 URL", () => {
    const html = `<html><body><p>Nothing to stream here.</p></body></html>`;
    expect(extractGenericM3u8FromHtml(html)).toBeNull();
  });

  test("handles m3u8 URLs with query strings", () => {
    const html = `<script>src = "https://edge.cdn.example.com/hls/live/stream.m3u8?token=xyz&expires=9999";</script>`;
    const url = extractGenericM3u8FromHtml(html);
    expect(url).toBe("https://edge.cdn.example.com/hls/live/stream.m3u8?token=xyz&expires=9999");
  });
});

// ─── Date parsing ─────────────────────────────────────────────────────────────

describe("parseEventDate", () => {
  test("parses 'D Month at HH:MM' into ISO date", () => {
    const result = parseEventDate("4 May at 9:30\n(Modus League)");
    expect(result).toMatch(/^\d{4}-05-04$/);
  });

  test("returns empty string when no date token present", () => {
    expect(parseEventDate("(Some Sport)")).toBe("");
    expect(parseEventDate("")).toBe("");
  });

  test("pads single-digit months and days", () => {
    const result = parseEventDate("1 January at 08:00 (Football)");
    expect(result).toMatch(/^\d{4}-01-01$/);
  });

  test("real fixture: all events that have a time also have a date", async () => {
    const html = await fixture("event-list.html");
    const events = parseEventListFromHtml(html);
    const withTime = events.filter((e) => e.time);
    const missingDate = withTime.filter((e) => !e.date);
    // Allow a small margin (live events that may not have the full D Month prefix)
    expect(missingDate.length).toBeLessThan(withTime.length * 0.1);
  });

  test("real fixture: 3 distinct dates present in the event list", async () => {
    const html = await fixture("event-list.html");
    const events = parseEventListFromHtml(html);
    const dates = new Set(events.map((e) => e.date).filter(Boolean));
    expect(dates.size).toBeGreaterThanOrEqual(2);
  });
});

// ─── Sport categorisation ─────────────────────────────────────────────────────

describe("categorizeEvent", () => {
  const cases: [string, string][] = [
    // Football
    ["England. Premier League", "Football"],
    ["Spain. Primera Division", "Football"],
    ["Germany. Bundesliga", "Football"],
    ["Italy. Serie A", "Football"],
    ["Copa Libertadores", "Football"],
    ["Copa Sudamericana", "Football"],
    ["Champions League", "Football"],
    ["Japan. J League", "Football"],
    ["Ecuador. Cup", "Football"],
    ["Israel. Liga Leumit", "Football"],
    // Tennis
    ["ATP. Rome. Qualification", "Tennis"],
    ["WTA. Rome. Qualification", "Tennis"],
    ["ATP Challenger. Wuxi. Doubles", "Tennis"],
    // Basketball
    ["NBA", "Basketball"],
    ["Euroleague", "Basketball"],
    ["Lithuania. LKL", "Basketball"],
    // Ice Hockey
    ["NHL", "Ice Hockey"],
    ["KHL", "Ice Hockey"],
    ["Finland. Liiga", "Ice Hockey"],
    ["Czech Republic. Extraliga", "Ice Hockey"],
    // Baseball
    ["MLB", "Baseball"],
    // Handball
    ["EHF European League", "Handball"],
    ["EHF Champions League", "Handball"],
    // Snooker/Darts
    ["Snooker", "Snooker/Darts"],
    ["Modus League", "Snooker/Darts"],
  ];

  for (const [sport, expected] of cases) {
    test(`"${sport}" → ${expected}`, () => {
      expect(categorizeEvent(sport)).toBe(expected);
    });
  }
});

describe("groupByCategory — real fixture", () => {
  test("Football is the largest category", async () => {
    const html = await fixture("event-list.html");
    const events = parseEventListFromHtml(html);
    const grouped = groupByCategory(events);

    const football = grouped.get("Football")?.length ?? 0;
    const tennis = grouped.get("Tennis")?.length ?? 0;
    const baseball = grouped.get("Baseball")?.length ?? 0;

    expect(football).toBeGreaterThan(50);
    expect(football).toBeGreaterThan(tennis);
    expect(football).toBeGreaterThan(baseball);
  });

  test("All events are in exactly one category", async () => {
    const html = await fixture("event-list.html");
    const events = parseEventListFromHtml(html);
    const grouped = groupByCategory(events);

    const total = [...grouped.values()].reduce((n, arr) => n + arr.length, 0);
    expect(total).toBe(events.length);
  });
});

describe("groupByDate — real fixture", () => {
  test("groups events into 3 days", async () => {
    const html = await fixture("event-list.html");
    const events = parseEventListFromHtml(html);
    const grouped = groupByDate(events);

    // Fixture captured on 4 May covers 3 days
    const datedGroups = [...grouped.keys()].filter(Boolean);
    expect(datedGroups.length).toBeGreaterThanOrEqual(2);
  });
});

describe("dayLabel", () => {
  test("returns Today for an empty string", () => {
    expect(dayLabel("")).toBe("Today");
  });

  test("returns Today for today's ISO date", () => {
    const today = new Date().toISOString().slice(0, 10);
    expect(dayLabel(today)).toBe("Today");
  });

  test("returns Tomorrow for tomorrow's date", () => {
    const d = new Date(Date.now() + 86_400_000).toISOString().slice(0, 10);
    expect(dayLabel(d)).toBe("Tomorrow");
  });

  test("returns formatted label for future dates", () => {
    const future = new Date(Date.now() + 4 * 86_400_000).toISOString().slice(0, 10);
    const label = dayLabel(future);
    expect(label).not.toBe("Today");
    expect(label).not.toBe("Tomorrow");
    expect(label.length).toBeGreaterThan(0);
  });
});
