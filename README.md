# live-tv

Watch live sports directly in Stremio (or VLC) — no browser fights, no popup ads. Scrapes stream links from [livetv.sx](https://livetv.sx) and serves them cleanly.

Two tools, one repo:

| Tool | Primary use |
|------|-------------|
| **Stremio Add-on** | Browse and watch events inside Stremio like any other add-on |
| **CLI** | Quick terminal access, pipe-friendly, opens streams in VLC or browser |

---

## One-line install (macOS and Linux)

For friends who only want to pick a match and watch in **VLC** (no Bun, no git clone).

**Install once:** [Docker](https://docs.docker.com/get-docker/) (Docker Desktop on Mac, or Docker Engine on Linux) and [VLC](https://www.videolan.org/). Docker must be running before you start the app.

**Single command** — downloads the latest [GitHub Release](https://github.com/benedyktdryl/live-tv/releases/latest), verifies `SHA256SUMS`, installs into `~/.local/share/livetv/bin` with links in `~/.local/bin`, then starts the interactive picker (same as `livetv-supervisor`; it will try to start the AceStream engine container if nothing is listening on port `6878`):

```bash
curl -fsSL https://raw.githubusercontent.com/benedyktdryl/live-tv/main/scripts/install-livetv.sh | bash -s -- --run
```

Install **without** starting the UI immediately (then run `~/.local/bin/livetv-supervisor` when you are ready):

```bash
curl -fsSL https://raw.githubusercontent.com/benedyktdryl/live-tv/main/scripts/install-livetv.sh | bash
```

**Linux note:** the install script supports **x86_64/amd64** Linux (Apple Silicon Linux is not built yet). **macOS** supports Apple Silicon (`arm64`) and Intel (`x86_64`).

**Fork or mirror:** point the installer at another repo that publishes the same release asset names:

```bash
LIVETV_INSTALL_REPO=yourname/live-tv curl -fsSL https://raw.githubusercontent.com/yourname/live-tv/main/scripts/install-livetv.sh | bash -s -- --run
```

**Windows:** there is no one-line shell installer yet; download `livetv-windows-x64.zip` from [Releases](https://github.com/benedyktdryl/live-tv/releases/latest), extract both `.exe` files to the same folder, install [Docker Desktop](https://docs.docker.com/desktop/setup/install/windows-install/) and VLC, then run `livetv-supervisor-windows-x64.exe`.

---

## How it works

livetv.sx lists sports events with three kinds of streams:

- **AceStream** (`acestream://HASH`) — P2P BitTorrent streams, best quality (up to 8 Mbps). Most big football/F1/NBA matches use this. Requires an AceStream engine.
- **Web embeds** (Aliez, Voodc, etc.) — Third-party iframe players embedded in a webpage. No extra software needed; quality varies. These are opened in your browser (Stremio shows an "Open" button; the CLI launches your system browser).
- **YouTube** — When a broadcaster goes public on YouTube. Plays directly everywhere.

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

**Standalone Docker container:**

```bash
docker run -d \
  --name acestream \
  -p 6878:6878 \
  --restart unless-stopped \
  jopsis/acestream:latest
```

**Docker Compose (addon + engine together) — recommended, see [Docker Compose](#docker-compose) below.**

**Native macOS:** download from [acestream.org](https://acestream.org) and launch AceStream Engine from the menu bar.

Verify it's running:

```bash
curl -s "http://localhost:6878/webui/api/service?method=get_version"
# → {"result":{"version":"..."},...}
```

> **Note:** Stremio does **not** play `acestream://` URIs natively — its built-in player needs a plain HTTP stream. The add-on exposes both the raw `acestream://` URI (handled by the AceStream desktop app if installed at OS level) and an `http://localhost:6878/ace/getstream?…` URL that works with any running engine including the Docker container.

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

## Docker Compose

The easiest way to get everything running: one command starts the AceStream engine **and** the Stremio add-on server together.

```bash
docker compose up -d
```

Services:

| Service | Port | Description |
|---------|------|-------------|
| `acestream` | 6878 | AceStream engine HTTP API |
| `addon` | 7000 | Stremio add-on manifest |

The `addon` container is pre-configured with `ACE_ENGINE_HOST=acestream` so streams resolve correctly inside the Docker network.

Install the add-on in Stremio: `http://127.0.0.1:7000/manifest.json`

Logs:

```bash
docker compose logs -f addon      # add-on server
docker compose logs -f acestream  # engine
```

Stop:

```bash
docker compose down
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
║  Manifest: http://127.0.0.1:7000/manifest.json
║  ...
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

| Stream option | What happens |
|---|---|
| `AceStream Engine 8000kbps` | Plays via `localhost:6878` — needs engine running (Docker/native) |
| `AceStream 8000kbps` | Opens via `acestream://` URI — needs AceStream desktop app installed |
| `YouTube` | Plays directly in Stremio's built-in player |
| `Aliez` / `Voodc` / `Web` | Stremio shows an **Open** button → opens in your browser |

4. Pick the highest-bitrate **AceStream Engine** option for best quality

### Environment variables

| Variable | Default | Description |
|---|---|---|
| `LIVETV_BASE_URL` | `https://livetv.sx` | Switch to a mirror if the main domain is blocked |
| `PORT` | `7000` | Port for the add-on server |
| `ACE_ENGINE_HOST` | `127.0.0.1` | AceStream engine host (use `acestream` with Docker Compose) |
| `ACE_ENGINE_PORT` | `6878` | AceStream engine port |

**Using a mirror domain:**

```bash
LIVETV_BASE_URL=https://livetv881.me bun run addon
```

Known mirrors: `livetv881.me`, `livetv878.me`, `livetv873.me`

---

## CLI

Useful for quick lookups, scripting, or watching in VLC without Stremio.

### Compiled binaries (GitHub Releases)

Pushing a git tag matching `v*` (for example `v0.2.0`) runs [`.github/workflows/release.yml`](.github/workflows/release.yml): cross-compiled **`livetv`** and **`livetv-supervisor`** for macOS arm64, macOS x64, Linux x64, and Windows x64, packaged as `.tar.gz` / `.zip` plus `SHA256SUMS`. Friends can use the [one-line install](#one-line-install-macos-and-linux) above instead of downloading archives by hand.

Extract both executables from the archive into the same directory. **`livetv-supervisor`** checks `http://127.0.0.1:6878/…` (or `ACE_ENGINE_HOST` / `ACE_ENGINE_PORT`); if the engine is down it tries **`docker run`** with [`jopsis/acestream:latest`](https://hub.docker.com/r/jopsis/acestream) (see [docs/ENGINE-REDISTRIBUTION.md](docs/ENGINE-REDISTRIBUTION.md) — engine bits are not bundled in these zips). Then it runs **`livetv`** with the same arguments as `bun run cli`. Run `./livetv-supervisor` (or `livetv-supervisor.exe` on Windows) instead of `livetv` when you want that behavior; use `./livetv` alone if you already started an engine (e.g. `docker compose up -d`).

Build release binaries locally:

```bash
bun run compile:release   # dist/livetv-darwin-arm64, …, and supervisor pairs
```

Native compile for the current machine only:

```bash
bun run compile           # dist/livetv + dist/livetv-supervisor
```

### Interactive mode

```bash
bun run cli
# or, from a release / after compile: ./livetv-supervisor
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
│  ○ 18:00  Miami Grand Prix  (Formula 1)
│  ○ 19:00  Espanyol – Real Madrid RM  (Spain. Primera Division)
│  ○ 19:00  Inter – Parma  (Italy. Serie A)
│  ○ 19:45  Lyon – Rennes  (France. Ligue 1)
```

Use **↑ ↓** to navigate, **Enter** to select. After picking an event:

```
◆  Select a stream:
│  ● ▶  AceStream 8000kbps          AceStream app / URI handler
│  ○ ▶  AceStream Engine 8000kbps   Engine at 127.0.0.1:6878
│  ○ ▶  AceStream 5000kbps          AceStream app / URI handler
│  ○ ▶  AceStream Engine 5000kbps   Engine at 127.0.0.1:6878
│  ○ ▶  YouTube                     YouTube broadcast
│  ○ 🌐 Aliez                       Web embed — opens in browser
│  ○ 🌐 Voodc                       Web embed — opens in browser
```

- `▶` streams open in VLC
- `🌐` streams open in your system browser (no extra software needed)

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

33 tests across two suites, all offline except the integration smoke test:

**`snapshot.test.ts`** — 21 tests, no network, runs in ~350ms
- Event list parsing against a saved `event-list.html` fixture: total count, dedup, live/upcoming flags, known event IDs with exact time/sport
- Stream link parsing against a saved `event-with-streams.html` fixture: all 4 YouTube video IDs extracted correctly
- Stream link parsing against a synthetic `event-with-all-streams.html`: AceStream (with bitrate), YouTube, Aliez, and Voodc all extracted with correct types and providers
- Aliez embed extractor against `aliez-player-live.html` (real saved page): exact m3u8 URL, CDN host, and session token
- Aliez embed extractor against `aliez-player-offline.html`: returns null cleanly
- Generic m3u8 extractor against `voodc-player-live.html`: https:// URL, protocol-relative URL, query string handling

**`scraper.test.ts`** — 12 tests
- Unit (4): Inline HTML snippets for stream link selector logic
- Unit (4): Resolver output — AceStream/YouTube/webplayer URL building, sort order, `isExternal` flag
- Unit (3): Embed resolver — network calls with graceful null fallback
- Integration (1): Live smoke test against `livetv.sx` — run this if streams stop showing up

### Refreshing fixtures

When livetv.sx changes its HTML structure the snapshot tests will fail with a clear diff. To update the fixtures:

```bash
# Refresh the event list
curl -A "Mozilla/5.0" --insecure https://livetv.sx/enx/allupcomingsports \
  > packages/core/src/__fixtures__/event-list.html

# Refresh an event detail page (replace ID with a current one that has streams)
curl -A "Mozilla/5.0" --insecure https://livetv.sx/enx/eventinfo/378047836_world_championships/ \
  > packages/core/src/__fixtures__/event-with-streams.html

# Refresh the Aliez player page
curl -A "Mozilla/5.0" -H "Referer: https://livetv.sx/" --insecure \
  https://emb.apl408.me/player/live.php?id=1 \
  > packages/core/src/__fixtures__/aliez-player-live.html
```

Then update any hardcoded values in `snapshot.test.ts` that changed (event IDs, video IDs, m3u8 tokens).

---

## Project structure

```
live-tv/
├── packages/
│   ├── core/               # Shared logic, no server/UI code here
│   │   └── src/
│   │       ├── scraper.ts          # Fetch + parse livetv.sx HTML
│   │       ├── resolver.ts         # Raw links → Stremio/VLC/browser stream objects
│   │       ├── embed-resolver.ts   # HLS extraction from Aliez/Voodc embed pages
│   │       ├── types.ts            # LiveEvent, StreamLink, ResolvedStream
│   │       ├── scraper.test.ts     # Unit + integration tests
│   │       ├── snapshot.test.ts    # Snapshot tests against HTML fixtures (no network)
│   │       └── __fixtures__/       # Saved HTML pages used by snapshot tests
│   ├── addon/              # Stremio add-on server (port 7000)
│   │   └── src/index.ts
│   └── cli/                # Terminal picker + VLC/browser launcher
│       └── src/index.ts
├── Dockerfile              # Container image for the add-on server
├── docker-compose.yml      # Full stack: add-on + AceStream engine
├── package.json            # Bun workspace + run scripts
└── tsconfig.json
```

---

## Troubleshooting

**No streams showing for an event**  
Streams are added just before and during the event. Check back 15–30 min before kickoff. Run `bun run cli streams <id>` to see what's currently available.

**AceStream streams not playing in Stremio**  
Stremio cannot play `acestream://` URIs directly — its built-in player needs a plain HTTP URL. Use the **"AceStream Engine"** stream variant which serves via `http://localhost:6878/ace/getstream?…`. Make sure the engine is running:

```bash
curl -s "http://localhost:6878/webui/api/service?method=get_version"
```

If it's not running, start it with Docker Compose (`docker compose up -d`) or standalone Docker.

**Web embed streams (Aliez, Voodc) don't play in Stremio**  
These are HTML embed pages — they can't be played as direct video streams. In Stremio, they appear with an **Open** button that launches them in your browser. In the CLI, selecting a `🌐` stream opens your system browser automatically.

**Site not loading / SSL errors**  
livetv.sx uses a non-standard certificate chain. This is handled automatically. If the domain is blocked in your region, set `LIVETV_BASE_URL` to a mirror and restart:

```bash
LIVETV_BASE_URL=https://livetv881.me bun run addon
```

Known mirrors: `livetv881.me`, `livetv878.me`, `livetv873.me`

**VLC not found by the CLI**  
The CLI checks `/Applications/VLC.app`, `/usr/bin/vlc`, `/usr/local/bin/vlc`, and `vlc` in `$PATH`. If VLC is installed elsewhere, open the stream URL manually from the `streams` command output.

**Port 7000 already in use**  
```bash
PORT=7001 bun run addon
# then install: http://127.0.0.1:7001/manifest.json in Stremio
```
