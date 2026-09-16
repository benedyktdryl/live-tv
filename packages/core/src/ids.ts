/** Build a composite event id: `{source}:{nativeId}` */
export function toCompositeId(source: string, nativeId: string): string {
  return `${source}:${nativeId}`;
}

/** Parse composite id; returns null when no source prefix is present. */
export function parseCompositeId(id: string): { source: string; nativeId: string } | null {
  const idx = id.indexOf(":");
  if (idx <= 0) return null;
  return { source: id.slice(0, idx), nativeId: id.slice(idx + 1) };
}

/** Legacy bare numeric ids default to livetv. */
export function normalizeEventId(id: string, defaultSource = "livetv"): string {
  return parseCompositeId(id) ? id : toCompositeId(defaultSource, id);
}
