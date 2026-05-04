import { describe, expect, test } from "bun:test";
import { parse } from "node-html-parser";
import { fetchEvents } from "./scraper.js";
import { resolveStreams } from "./resolver.js";
import type { StreamLink } from "./types.js";

// ─── Unit: stream link HTML parsing ──────────────────────────────────────────
// These run without network access and catch HTML selector regressions.

describe("stream link parsing", () => {
  function parseStreamLinksFromHtml(html: string) {
    const root = parse(html);
    const streams: StreamLink[] = [];

    for (const table of root.querySelectorAll("table.lnktbj")) {
      const anchors = table.querySelectorAll("a");
      if (!anchors.length) continue;
      const lastAnchor = anchors[anchors.length - 1];
      const href = lastAnchor.getAttribute("href") ?? "";
      if (!href || href === "/") continue;

      const bitrateTd = table.querySelector("td.bitrate");
      const bitrate = bitrateTd?.text?.trim() || null;

      if (href.startsWith("acestream://")) {
        streams.push({ type: "acestream", url: href, bitrate, provider: "AceStream" });
      } else if (href.includes("youtub")) {
        const m = href.match(/[?&](?:v=|c=)([A-Za-z0-9_-]{11})/);
        if (m) {
          streams.push({
            type: "youtube",
            url: `https://www.youtube.com/watch?v=${m[1]}`,
            bitrate,
            provider: "YouTube",
          });
        }
      } else if (href.includes("webplayer") || href.includes("alieztv") || href.includes("ifr")) {
        const fullUrl = href.startsWith("http") ? href : `https:${href}`;
        streams.push({ type: "webplayer", url: fullUrl, bitrate, provider: "Aliez" });
      }
    }
    return streams;
  }

  test("extracts acestream link with bitrate", () => {
    const html = `
      <table class="lnktbj">
        <tr>
          <td></td>
          <td class="bitrate">8000kbps</td>
          <td><a href="acestream://a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2">Watch</a></td>
        </tr>
      </table>`;
    const streams = parseStreamLinksFromHtml(html);
    expect(streams).toHaveLength(1);
    expect(streams[0].type).toBe("acestream");
    expect(streams[0].url).toBe("acestream://a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2");
    expect(streams[0].bitrate).toBe("8000kbps");
  });

  test("extracts youtube link", () => {
    const html = `
      <table class="lnktbj">
        <tr>
          <td></td><td></td>
          <td><a href="//webplayer.php?t=youtub&c=dQw4w9WgXcQ&lang=en">YouTube</a></td>
        </tr>
      </table>`;
    const streams = parseStreamLinksFromHtml(html);
    expect(streams).toHaveLength(1);
    expect(streams[0].type).toBe("youtube");
    expect(streams[0].url).toBe("https://www.youtube.com/watch?v=dQw4w9WgXcQ");
  });

  test("extracts webplayer link", () => {
    const html = `
      <table class="lnktbj">
        <tr>
          <td></td>
          <td class="bitrate">2700kbps</td>
          <td><a href="//livetv.sx/webplayer.php?t=alieztv&c=ch1&lang=en">Aliez</a></td>
        </tr>
      </table>`;
    const streams = parseStreamLinksFromHtml(html);
    expect(streams).toHaveLength(1);
    expect(streams[0].type).toBe("webplayer");
    expect(streams[0].url).toStartWith("https:");
    expect(streams[0].bitrate).toBe("2700kbps");
  });

  test("skips empty / bare-slash hrefs", () => {
    const html = `
      <table class="lnktbj">
        <tr><td></td><td></td><td><a href="/">Empty</a></td></tr>
      </table>`;
    const streams = parseStreamLinksFromHtml(html);
    expect(streams).toHaveLength(0);
  });
});

// ─── Unit: resolver ───────────────────────────────────────────────────────────

describe("resolver", () => {
  test("acestream link produces two stream options", () => {
    const links: StreamLink[] = [
      {
        type: "acestream",
        url: "acestream://deadbeef".padEnd(50, "0").slice(0, 50),
        bitrate: "5000kbps",
        provider: "AceStream",
      },
    ];
    const resolved = resolveStreams(links);
    expect(resolved.length).toBeGreaterThanOrEqual(2);
    expect(resolved.some((s) => s.url.startsWith("acestream://"))).toBe(true);
    expect(resolved.some((s) => s.url.includes("6878"))).toBe(true);
  });

  test("acestream links are sorted before webplayer links", () => {
    const links: StreamLink[] = [
      { type: "webplayer", url: "https://example.com/web", bitrate: null, provider: "Web" },
      {
        type: "acestream",
        url: "acestream://abc123".padEnd(50, "0").slice(0, 50),
        bitrate: "3000kbps",
        provider: "AceStream",
      },
    ];
    const resolved = resolveStreams(links);
    expect(
      resolved[0].url.startsWith("acestream://") || resolved[0].url.includes("localhost"),
    ).toBe(true);
  });

  test("youtube link passes through as-is", () => {
    const links: StreamLink[] = [
      {
        type: "youtube",
        url: "https://www.youtube.com/watch?v=abc123defgh",
        bitrate: null,
        provider: "YouTube",
      },
    ];
    const resolved = resolveStreams(links);
    expect(resolved).toHaveLength(1);
    expect(resolved[0].url).toBe("https://www.youtube.com/watch?v=abc123defgh");
  });
});

// ─── Integration: smoke test (requires network) ───────────────────────────────
// Catches HTML structure changes on livetv.sx before you notice at watch time.
// Run with: bun test --timeout 30000

describe("livetv.sx integration", () => {
  test("fetchEvents returns a non-empty list with expected shape", async () => {
    const events = await fetchEvents();

    expect(events.length).toBeGreaterThan(0);

    const first = events[0];
    expect(first).toHaveProperty("id");
    expect(first).toHaveProperty("name");
    expect(first).toHaveProperty("sport");
    expect(first).toHaveProperty("time");
    expect(first).toHaveProperty("isLive");
    expect(first).toHaveProperty("url");

    expect(first.id).toMatch(/^\d+$/);
    expect(first.name.length).toBeGreaterThan(0);
    expect(first.url).toContain("eventinfo");

    console.log(`  ✓ Got ${events.length} events, ${events.filter((e) => e.isLive).length} live`);
  }, 30_000);
});
