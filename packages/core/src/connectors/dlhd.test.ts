import { describe, expect, test } from "bun:test";
import path from "path";
import { parseDlhdScheduleFromHtml, dlhdEventNativeId } from "./dlhd.js";

const FIXTURES = path.join(import.meta.dir, "../__fixtures__");

describe("dlhd parser", () => {
  test("dlhdEventNativeId is stable", () => {
    const id = dlhdEventNativeId("Team A vs Team B", "18:00");
    expect(id).toBe("1800-team-a-vs-team-b");
  });

  test("parseDlhdScheduleFromHtml extracts scheduled events with channels", async () => {
    const html = await Bun.file(path.join(FIXTURES, "dlhd-schedule.html")).text();
    const events = parseDlhdScheduleFromHtml(html);

    expect(events.length).toBeGreaterThan(0);
    for (const e of events) {
      expect(e.nativeId.length).toBeGreaterThan(0);
      expect(e.channels.length).toBeGreaterThan(0);
      expect(e.name.length).toBeGreaterThan(0);
    }
  });
});

if (process.env.SKIP_DLHD_INTEGRATION !== "1") {
  describe("dlhd integration", () => {
    test("listEvents returns schedule from live site", async () => {
      const { dlhdConnector } = await import("./dlhd.js");
      const events = await dlhdConnector.listEvents();
      expect(events.length).toBeGreaterThan(0);
      expect(events[0].id).toMatch(/^dlhd:/);
      expect(events[0].name.length).toBeGreaterThan(0);
    }, 30_000);
  });
}
