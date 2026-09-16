import { parseCompositeId, normalizeEventId } from "./ids.js";
import type { EventDetail, LiveEvent } from "./types.js";
import { getConnector, parseSourceIds, defaultSourceIds } from "./connectors/registry.js";

export { parseSourceIds, defaultSourceIds };

function sortMergedEvents(events: LiveEvent[]): LiveEvent[] {
  return [...events].sort((a, b) => {
    if (a.isLive && !b.isLive) return -1;
    if (!a.isLive && b.isLive) return 1;
    if (a.date !== b.date) return (a.date || "9999").localeCompare(b.date || "9999");
    return a.time.localeCompare(b.time);
  });
}

/**
 * Fetch and merge events from the given connectors.
 * A failing source is logged and skipped; others still contribute.
 */
export async function fetchEventsFromSources(sourceIds?: string[]): Promise<LiveEvent[]> {
  const ids = sourceIds ?? defaultSourceIds();
  const results = await Promise.allSettled(
    ids.map(async (sourceId) => {
      const connector = getConnector(sourceId);
      if (!connector) throw new Error(`Unknown source: ${sourceId}`);
      return connector.listEvents();
    }),
  );

  const merged: LiveEvent[] = [];
  for (let i = 0; i < results.length; i++) {
    const result = results[i];
    const sourceId = ids[i];
    if (result.status === "fulfilled") {
      merged.push(...result.value);
    } else {
      console.warn(`[aggregator] ${sourceId} failed:`, result.reason);
    }
  }

  return sortMergedEvents(merged);
}

/** Default: all registered sources. */
export async function fetchEvents(sourceIds?: string[]): Promise<LiveEvent[]> {
  const envSources = process.env.LIVE_TV_SOURCES;
  const ids = sourceIds ?? (envSources ? parseSourceIds(envSources) : undefined);
  return fetchEventsFromSources(ids);
}

export async function fetchEventDetail(eventId: string): Promise<EventDetail | null> {
  const composite = normalizeEventId(eventId);
  const parsed = parseCompositeId(composite);
  if (!parsed) return null;

  const connector = getConnector(parsed.source);
  if (!connector) return null;

  return connector.getEventDetail(parsed.nativeId);
}
