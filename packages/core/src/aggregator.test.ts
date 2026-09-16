import { describe, expect, test } from "bun:test";
import { fetchEventsFromSources } from "./aggregator.js";
import { parseCompositeId, normalizeEventId } from "./ids.js";
import { parseSourceIds, defaultSourceIds } from "./connectors/registry.js";

describe("ids", () => {
  test("parseCompositeId splits source and native id", () => {
    expect(parseCompositeId("livetv:123")).toEqual({ source: "livetv", nativeId: "123" });
    expect(parseCompositeId("buffsports:soccer/live-x")).toEqual({
      source: "buffsports",
      nativeId: "soccer/live-x",
    });
    expect(parseCompositeId("123")).toBeNull();
  });

  test("normalizeEventId adds livetv prefix for legacy ids", () => {
    expect(normalizeEventId("371315132")).toBe("livetv:371315132");
    expect(normalizeEventId("buffsports:abc")).toBe("buffsports:abc");
  });
});

describe("parseSourceIds", () => {
  test("returns all sources when input empty", () => {
    expect(parseSourceIds(undefined)).toEqual(defaultSourceIds());
  });

  test("filters unknown sources", () => {
    expect(parseSourceIds("livetv,unknown,buffsports")).toEqual(["livetv", "buffsports"]);
  });
});

describe("fetchEventsFromSources", () => {
  test("skips unknown sources without failing the merge", async () => {
    if (process.env.SKIP_LIVETV_INTEGRATION === "1") return;
    const events = await fetchEventsFromSources(["livetv", "not-a-real-source"]);
    expect(events.length).toBeGreaterThan(0);
    expect(events.every((e) => e.source === "livetv")).toBe(true);
  }, 30_000);

  test("livetv-only fetch returns composite ids", async () => {
    if (process.env.SKIP_LIVETV_INTEGRATION === "1") return;
    const events = await fetchEventsFromSources(["livetv"]);
    expect(events.length).toBeGreaterThan(0);
    expect(events[0].id).toMatch(/^livetv:/);
    expect(events[0].source).toBe("livetv");
  }, 30_000);
});
