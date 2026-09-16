import type { EventDetail, LiveEvent } from "../types.js";

export interface SourceConnector {
  /** Stable id: livetv | buffsports | dlhd | strumyk */
  id: string;
  displayName: string;
  baseUrl: string;
  listEvents(): Promise<LiveEvent[]>;
  getEventDetail(nativeId: string): Promise<EventDetail | null>;
}
