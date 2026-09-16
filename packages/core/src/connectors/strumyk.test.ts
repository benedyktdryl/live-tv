import { describe, expect, test } from "bun:test";
import path from "path";
import { isCloudflareChallengePage } from "../http.js";
import { parseStrumykEventListFromHtml } from "./strumyk.js";

const FIXTURES = path.join(import.meta.dir, "../__fixtures__");

describe("isCloudflareChallengePage", () => {
  test("detects CF interstitial HTML", () => {
    expect(isCloudflareChallengePage("<title>Just a moment...</title>")).toBe(true);
    expect(isCloudflareChallengePage("<html><body>Schedule</body></html>")).toBe(false);
  });
});

describe("strumyk parser", () => {
  test("parseStrumykEventListFromHtml extracts matches from fixture", async () => {
    const html = await Bun.file(path.join(FIXTURES, "strumyk-schedule.html")).text();
    const events = parseStrumykEventListFromHtml(html);

    expect(events).toHaveLength(3);
    const legia = events.find((e) => e.nativeId.includes("legia"));
    expect(legia).toBeDefined();
    expect(legia!.isLive).toBe(true);
    expect(legia!.sport).toContain("Piłka");
  });
});
