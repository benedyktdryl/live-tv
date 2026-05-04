export interface LiveEvent {
  id: string;
  name: string;
  slug: string;
  sport: string;
  time: string;
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
