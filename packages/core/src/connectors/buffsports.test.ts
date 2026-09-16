import { describe, expect, test } from "bun:test";
import path from "path";
import { parseBuffsportsEventListFromHtml, slugFromPath } from "./buffsports.js";

const FIXTURES = path.join(import.meta.dir, "../__fixtures__");

describe("buffsports parser", () => {
  test("slugFromPath strips leading slash", () => {
    expect(slugFromPath("/soccer/live-a-vs-b")).toBe("soccer/live-a-vs-b");
  });

  test("parseBuffsportsEventListFromHtml extracts soccer matches", async () => {
    const html = await Bun.file(path.join(FIXTURES, "buffsports-soccer-list.html")).text();
    const events = parseBuffsportsEventListFromHtml(html);

    expect(events.length).toBeGreaterThan(5);
    const arsenal = events.find((e) => e.nativeId.includes("arsenal-vs-burnley"));
    expect(arsenal).toBeDefined();
    expect(arsenal!.name).toContain("Arsenal");
    expect(arsenal!.date).toBe("2026-05-18");
    expect(arsenal!.time).toBe("20:00");
    expect(arsenal!.isLive).toBe(true);
  });
});

if (process.env.SKIP_BUFFSPORTS_INTEGRATION !== "1") {
  describe("buffsports integration", () => {
    test("listEvents returns soccer matches from live site", async () => {
      const { buffsportsConnector } = await import("./buffsports.js");
      const events = await buffsportsConnector.listEvents();
      expect(events.length).toBeGreaterThan(0);
      expect(events[0].id).toMatch(/^buffsports:/);
    }, 30_000);
  });
}
