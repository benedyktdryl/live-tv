# live-tv

Watch live sports directly in Stremio (or VLC) — no browser fights, no popup ads. Scrapes stream links from [livetv.sx](https://livetv.sx) and serves them cleanly.

Two tools, one repo:

| Tool | Primary use |
|------|-------------|
| **Stremio Add-on** | Browse and watch events inside Stremio like any other add-on |
| **CLI** | Quick terminal access, pipe-friendly, opens streams in VLC |

---

## How it works

livetv.sx lists sports events with three kinds of streams:

- **AceStream** (`acestream://HASH`) — P2P BitTorrent streams, best quality (up to 8 Mbps). Most big football/F1/NBA matches use this.
- **Web embeds** (Aliez, Voodc) — Third-party iframe players. No extra software needed but quality varies.
- **YouTube** — When a broadcaster goes public on YouTube.

This tool fetches the raw HTML (no JS execution needed — the site is server-rendered), extracts the links, and hands them off to Stremio or VLC.

> Streams only appear ~30 min before kickoff and disappear after the event ends. The catalog shows all upcoming events; the stream list fills in as they go live.

---

## Prerequisites

### Bun

```bash
curl -fsSL https://bun.sh/install | bash
```

### AceStream Engine

Required for AceStream streams (most high-quality football, F1, NBA broadcasts). Skip this if you only care about YouTube/web embed streams.

**Docker (recommended — no install, auto-restarts):**

```bash
docker run -d \
  --name acestream \
  -p 6878:6878 \
  --restart unless-stopped \
  acestream/acestream-engine
```

**Native macOS:** download from [acestream.org](https://acestream.org) and launch AceStream Engine from the menu bar.

Verify it's running:

```bash
curl -s "http://localhost:6878/webui/api/service?method=get_version"
# → {"result":{"version":"..."},...}
```

### Stremio (for the add-on)

Download from [stremio.com](https://www.stremio.com/downloads). The free version is fine.

---

## Setup

```bash
git clone <this-repo> live-tv
cd live-tv
bun install
```

---

## Stremio Add-on

### 1. Start the server

```bash
bun run addon
```

Output:

```
HTTP addon accessible at: http://127.0.0.1:7000/manifest.json

╔══════════════════════════════════════════╗
║  LiveTV.sx Stremio Add-on is running!    ║
╠══════════════════════════════════════════╣
║  Manifest: http://127.0.0.1:7000/manifest.json║
║                                          ║
║  To install in Stremio:                  ║
║  1. Open Stremio                         ║
║  2. Go to Add-ons search                 ║
║  3. Paste the manifest URL above         ║
╚══════════════════════════════════════════╝

[cache] refreshed 500 events
```

Keep this terminal running while you use Stremio.

### 2. Install in Stremio

1. Open Stremio → click the **Add-ons** icon (puzzle piece) in the sidebar
2. Click the **search bar** at the top
3. Paste `http://127.0.0.1:7000/manifest.json`
4. Hit Enter → click **Install**

You now have a **LiveTV.sx Sports** catalog in your Board.

### 3. Watch a match

1. Open the **LiveTV.sx Sports** catalog — you'll see all upcoming events sorted by time
2. Live events show **🔴 LIVE** in the description
3. Click an event → Stremio fetches stream options:

| Stream option | When it works |
|---|---|
| `AceStream 8000kbps` | AceStream desktop app installed |
| `AceStream Engine 8000kbps` | AceStream engine running on port 6878 (Docker or native) |
| `YouTube` | Always works in Stremio's built-in player |
| `Aliez / Web` | Depends on the embed — may need external browser |

4. Pick the highest bitrate AceStream Engine option for best quality

### Environment variables

| Variable | Default | Description |
|---|---|---|
| `LIVETV_BASE_URL` | `https://livetv.sx` | Switch to a mirror if the main domain is blocked |
| `PORT` | `7000` | Port for the add-on server |
| `ACE_ENGINE_HOST` | `127.0.0.1` | AceStream engine host |
| `ACE_ENGINE_PORT` | `6878` | AceStream engine port |

**Using a mirror domain:**

```bash
LIVETV_BASE_URL=https://livetv881.me bun run addon
```

Known mirrors: `livetv881.me`, `livetv878.me`, `livetv873.me`

---

## CLI

Useful for quick lookups, scripting, or watching in VLC without Stremio.

### Interactive mode

```bash
bun run cli
```

What it does:

1. Checks if AceStream engine is available and warns you if not
2. Fetches all events with a spinner
3. Shows a scrollable list — **live events appear first**, then upcoming sorted by time:

```
◆  Select an event to watch:
│  ● 9:00  Metalurh Zp – Victoria  (Ukraine. First League)  🔴
│  ○ 10:00  World Championships  (World Championship)  🔴
│  ○ 11:00  Hampshire – Glamorgan  (County Championship One)
│  ○ 11:00  Leicestershire – Nottinghamshire  (County Championship One)
│  ○ 18:00  Miami Grand Prix  (Formula 1)
│  ○ 19:00  Espanyol – Real Madrid RM  (Spain. Primera Division)
│  ○ 19:00  Inter – Parma  (Italy. Serie A)
│  ○ 19:45  Lyon – Rennes  (France. Ligue 1)
```

Use **↑ ↓** to navigate, **Enter** to select. After picking an event:

```
◆  Select a stream:
│  ● AceStream 8000kbps          AceStream app required
│  ○ AceStream Engine 8000kbps   AceStream engine on localhost:6878
│  ○ AceStream 5000kbps          AceStream app required
│  ○ AceStream Engine 5000kbps   AceStream engine on localhost:6878
│  ○ YouTube                     YouTube broadcast
```

Pick one → VLC opens.

> **Tip:** The list supports keyboard search — just start typing a team or league name and the list filters as you type. For example type `real madrid` to jump straight to that event.

### Non-interactive commands

These are pipe-friendly and exit immediately.

#### `list` — all events as JSON

```bash
bun run cli list
```

```json
[
  {
    "id": "378053369",
    "name": "Metalurh Zp – Victoria",
    "slug": "metalurh_zp_victoria",
    "sport": "Ukraine. First League",
    "time": "9:00",
    "score": null,
    "isLive": true,
    "url": "https://livetv.sx/enx/eventinfo/378053369_metalurh_zp_victoria/",
    "posterUrl": null
  },
  ...
]
```

**Filter to live events only:**

```bash
bun run cli list | jq '[.[] | select(.isLive == true)]'
```

**Find events by team or league:**

```bash
bun run cli list | jq '[.[] | select(.name | ascii_downcase | contains("real madrid"))]'
bun run cli list | jq '[.[] | select(.sport | ascii_downcase | contains("premier league"))]'
```

**Show just names and times:**

```bash
bun run cli list | jq '.[] | "\(.time)  \(.name)  (\(.sport))"' -r
```

Example output:

```
9:00  Metalurh Zp – Victoria  (Ukraine. First League)
10:00  World Championships  (World Championship)
18:00  Miami Grand Prix  (Formula 1)
18:35  Pittsburgh – Cincinnati  (MLB)
19:00  Espanyol – Real Madrid RM  (Spain. Primera Division)
19:00  Inter – Parma  (Italy. Serie A)
19:45  Lyon – Rennes  (France. Ligue 1)
20:00  Detroit – Orlando  (NBA)
```

#### `streams <event-id>` — resolved stream URLs for an event

```bash
bun run cli streams 378053369
```

```json
[
  {
    "name": "YouTube",
    "url": "https://www.youtube.com/watch?v=vptJTEhd2nA",
    "description": "YouTube broadcast"
  }
]
```

For a match with AceStream links:

```json
[
  {
    "name": "AceStream 8000kbps",
    "url": "acestream://a1b2c3d4...40chars",
    "description": "AceStream app required"
  },
  {
    "name": "AceStream Engine 8000kbps",
    "url": "http://127.0.0.1:6878/ace/getstream?content_id=a1b2c3d4...40chars",
    "description": "AceStream engine on localhost:6878"
  },
  {
    "name": "AceStream 5000kbps",
    "url": "acestream://e5f6a7b8...40chars",
    "description": "AceStream app required"
  },
  ...
]
```

Get just the best playable URL:

```bash
bun run cli streams 371315132 | jq -r '.[0].url'
```

#### `watch <event-id>` — open best stream in VLC immediately

```bash
bun run cli watch 378053369
```

Picks the highest-bitrate AceStream Engine URL and opens VLC. No prompts.

```
▶  Opened VLC: http://127.0.0.1:6878/ace/getstream?content_id=a1b2c3...
```

**Get the event ID from the URL** — copy it from the livetv.sx event page:

```
https://livetv.sx/enx/eventinfo/378053369_metalurh_zp_victoria/
                                 ^^^^^^^^^
                                 this is the ID
```

### Scripting examples

Open the first live football event automatically:

```bash
ID=$(bun run cli list | jq -r '[.[] | select(.isLive and (.sport | ascii_downcase | contains("football")))] | .[0].id')
bun run cli watch "$ID"
```

Print all stream URLs for tonight's Champions League match:

```bash
bun run cli list \
  | jq -r '[.[] | select(.name | ascii_downcase | contains("champions league"))] | .[0].id' \
  | xargs -I{} bun run cli streams {} \
  | jq -r '.[].url'
```

---

## Tests

```bash
bun test
```

8 tests total:
- **Unit** (4): HTML stream-link parsing — catches selector regressions without network access
- **Unit** (3): Resolver output — verifies AceStream/YouTube/webplayer URL building
- **Integration** (1): Live smoke test against livetv.sx — run this if streams stop showing up to check whether the site changed its HTML structure

---

## Project structure

```
live-tv/
├── packages/
│   ├── core/               # Shared logic, no server/UI code here
│   │   └── src/
│   │       ├── scraper.ts        # Fetch + parse livetv.sx HTML
│   │       ├── resolver.ts       # Raw links → Stremio/VLC stream objects
│   │       ├── types.ts          # LiveEvent, StreamLink, ResolvedStream
│   │       └── scraper.test.ts   # bun test suite
│   ├── addon/              # Stremio add-on server (port 7000)
│   │   └── src/index.ts
│   └── cli/                # Terminal picker + VLC launcher
│       └── src/index.ts
├── package.json            # Bun workspace + run scripts
└── tsconfig.json
```

---

## Troubleshooting

**No streams showing for an event**  
Streams are added just before and during the event. Check back 15–30 min before kickoff. Run `bun run cli streams <id>` to see what's currently available.

**AceStream streams not playing in Stremio**  
Use the **"AceStream Engine"** stream variant — it serves via `localhost:6878` as a plain HTTP stream that Stremio's built-in player can handle. Make sure the engine is running (`curl localhost:6878/webui/api/service?method=get_version`).

**Site not loading / SSL errors**  
livetv.sx uses a non-standard certificate chain. This is handled automatically. If the domain is blocked in your region, set `LIVETV_BASE_URL` to a mirror and restart:

```bash
LIVETV_BASE_URL=https://livetv881.me bun run addon
```

**VLC not found by the CLI**  
The CLI checks `/Applications/VLC.app`, `/usr/bin/vlc`, `/usr/local/bin/vlc`, and `vlc` in `$PATH`. If VLC is installed elsewhere, open the stream URL manually from the `streams` command output.

**Port 7000 already in use**  
```bash
PORT=7001 bun run addon
# then install: http://127.0.0.1:7001/manifest.json in Stremio
```
