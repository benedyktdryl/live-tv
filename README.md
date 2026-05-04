# live-tv

Watch live sports directly in Stremio (or VLC) by scraping stream links from [livetv.sx](https://livetv.sx).

Two tools in one Bun monorepo:

| Tool | What it does |
|------|-------------|
| **Stremio Add-on** (primary) | Local add-on that exposes a catalog of live/upcoming sports events and their streams inside Stremio |
| **CLI** (secondary) | Interactive terminal picker that opens streams in VLC |

## How it works

livetv.sx aggregates sports streams from two sources:

1. **AceStream** (`acestream://HASH`) — P2P BitTorrent-based streams. Best quality (up to 8 Mbps). Requires the AceStream engine.
2. **Web embeds** (Aliez, Voodc, etc.) — Browser iframe embeds. No extra software needed, but quality varies.
3. **YouTube** — When broadcasters stream on YouTube publicly.

This tool scrapes the event pages and returns all available streams to Stremio or VLC.

## Prerequisites

### 1. Bun

```bash
curl -fsSL https://bun.sh/install | bash
```

### 2. AceStream Engine (for AceStream links)

Most high-quality sports streams use AceStream. Without it you'll only see web embed / YouTube streams.

**Option A — Docker (recommended):**
```bash
docker run -d --name acestream -p 6878:6878 --restart unless-stopped acestream/acestream-engine
```

**Option B — Native macOS:**
Download from [acestream.org](https://acestream.org) and launch AceStream Engine.

Verify it's running:
```bash
curl http://localhost:6878/webui/api/service?method=get_version
```

### 3. Stremio

Download from [stremio.com](https://www.stremio.com/downloads).

## Setup

```bash
git clone <this-repo> live-tv
cd live-tv
bun install
```

## Stremio Add-on

### Start the add-on server

```bash
bun run addon
```

The server starts at `http://localhost:7000`. You'll see:

```
HTTP addon accessible at: http://127.0.0.1:7000/manifest.json
```

### Install in Stremio

1. Open Stremio
2. Click the **🔍 Search** icon in the add-ons section
3. Paste `http://127.0.0.1:7000/manifest.json` in the search box
4. Click **Install**

You'll now have a **"LiveTV.sx Sports"** catalog in Stremio with all live and upcoming sports events.

### Watching a stream

1. Open the **LiveTV.sx Sports** catalog
2. Find your match (live events show 🔴 LIVE)
3. Click the event
4. Stremio shows available streams — pick one:
   - **AceStream BITRATE** — opens via native `acestream://` handler (AceStream app required)
   - **AceStream Engine BITRATE** — streams via `localhost:6878` (AceStream engine must be running)
   - **YouTube / Web** — opens in Stremio's built-in player

> **Note:** Streams only appear when an event is live or ~30 minutes before start. The catalog always shows upcoming events but the stream list will be empty until streams go live.

### Environment variables

| Variable | Default | Description |
|----------|---------|-------------|
| `LIVETV_BASE_URL` | `https://livetv.sx` | Base URL (use mirror if main domain is blocked) |
| `PORT` | `7000` | Port for the add-on server |
| `ACE_ENGINE_HOST` | `127.0.0.1` | AceStream engine host |
| `ACE_ENGINE_PORT` | `6878` | AceStream engine port |

Mirror domains: `livetv881.me`, `livetv878.me`, `livetv873.me`

```bash
LIVETV_BASE_URL=https://livetv881.me bun run addon
```

## CLI (VLC)

The CLI is useful for quick access without Stremio, or for opening streams directly in VLC.

### Interactive mode

```bash
bun run cli
```

1. Shows all live + upcoming events (live ones first)
2. Select an event with arrow keys
3. Select a stream quality
4. VLC opens automatically

### Non-interactive commands

```bash
# List all events as JSON
bun run cli list

# Get stream URLs for a specific event ID
bun run cli streams 371315132

# Open best stream for an event directly in VLC
bun run cli watch 371315132
```

Event IDs come from the livetv.sx URL: `eventinfo/371315132_team-a_team-b/` → ID is `371315132`.

## Project structure

```
live-tv/
├── packages/
│   ├── core/          # Shared scraping + stream resolution logic
│   │   └── src/
│   │       ├── scraper.ts   # Fetch events + stream links from livetv.sx
│   │       ├── resolver.ts  # Convert raw links to Stremio/VLC stream objects
│   │       └── types.ts     # Shared TypeScript types
│   ├── addon/         # Stremio add-on server
│   │   └── src/index.ts
│   └── cli/           # Terminal picker + VLC launcher
│       └── src/index.ts
├── package.json       # Bun workspace root
└── tsconfig.json
```

## Troubleshooting

**No streams showing for an event?**  
Streams are added by livetv.sx users shortly before and during the event. Check back 15–30 minutes before kickoff.

**AceStream streams not playing in Stremio?**  
Make sure the AceStream engine is running on port 6878. Use the "AceStream Engine" stream option which goes through `localhost:6878` as an HTTP stream.

**Site not loading / connection errors?**  
The site may be blocked in your region or the domain may have changed. Try setting `LIVETV_BASE_URL` to a mirror domain.

**VLC not found?**  
The CLI looks for VLC in common macOS/Linux locations. Make sure VLC is installed. On macOS it expects `/Applications/VLC.app`.
