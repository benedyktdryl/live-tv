import { buffsportsConnector } from "./buffsports.js";
import { dlhdConnector } from "./dlhd.js";
import { livetvConnector } from "./livetv.js";
import { strumykConnector } from "./strumyk.js";
import type { SourceConnector } from "./types.js";

const CONNECTORS: SourceConnector[] = [
  livetvConnector,
  buffsportsConnector,
  dlhdConnector,
  strumykConnector,
];

const byId = new Map(CONNECTORS.map((c) => [c.id, c]));

export function listConnectors(): SourceConnector[] {
  return [...CONNECTORS];
}

export function getConnector(id: string): SourceConnector | undefined {
  return byId.get(id);
}

export function defaultSourceIds(): string[] {
  return CONNECTORS.map((c) => c.id);
}

export function parseSourceIds(input: string | undefined): string[] {
  if (!input?.trim()) return defaultSourceIds();
  const ids = input
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
  const valid = ids.filter((id) => byId.has(id));
  return valid.length > 0 ? valid : defaultSourceIds();
}
