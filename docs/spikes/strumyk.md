# Spike: strumyk.cfd

## URL

- Home / schedule: `https://strumyk.cfd/`

## Access

- **Cloudflare** bot challenge on plain `fetch` / curl (HTTP 403 or “Just a moment…” HTML).
- Connector detects challenge via `isCloudflareChallengePage()` and returns **empty list** with a warning (other sources still work in the aggregator).

## Expected HTML (when accessible)

Parser supports:

- `a[href*='/mecz/']`, `/stream/`, `/watch/`, `/live/`
- `.event-card`, `.match-card`
- `data-sport`, `data-time`, `data-date`, `.live` badges

Fixture: `packages/core/src/__fixtures__/strumyk-schedule.html` (synthetic, for unit tests).

## Streams

- Same as BuffStreams/DLHD: prefer iframe/m3u8 from HTML if present, else event page as `webplayer`.

## Native ID

Path without leading slash, e.g. `mecz/legia-warszawa-vs-lech-poznan`.

## Refreshing fixtures

When CF allows browser access, save the schedule page:

```bash
curl -fsSL -A "Mozilla/5.0" "https://strumyk.cfd/" -o packages/core/src/__fixtures__/strumyk-schedule-live.html
```

## Env

- `STRUMYK_BASE_URL` — default `https://strumyk.cfd`
- `SKIP_STRUMYK_INTEGRATION=1` — optional; live list may be empty behind CF
