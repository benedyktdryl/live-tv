export interface LiveEvent {
  id: string;
  name: string;
  slug: string;
  sport: string;
  /** HH:MM start time, or "" when not parseable */
  time: string;
  /** ISO date "YYYY-MM-DD", or "" when not parseable */
  date: string;
  score: string | null;
  isLive: boolean;
  url: string;
  posterUrl: string | null;
}

export interface StreamLink {
  type: "acestream" | "webplayer" | "youtube";
  url: string;
  bitrate: string | null;
  provider: string;
}

export interface EventDetail extends LiveEvent {
  streams: StreamLink[];
}
