# Spike: dlhd.pk (DaddyLive)

## URLs

- Schedule: `https://dlhd.pk/`
- Channel watch: `https://dlhd.pk/watch.php?id={id}`
- Stream iframe: `https://dlhd.pk/stream/stream-{id}.php`

## Schedule HTML

- Structure: `.schedule__day` → `.schedule__category` → `.schedule__event`
- Event: `.schedule__eventTitle`, `.schedule__time[data-time]`, header `data-title`
- Channels: `.schedule__channels a[href="/watch.php?id=…"]` with `title` / `data-ch`

## Streams

- Watch page embeds `iframe src="/stream/stream-{id}.php"`.
- Stream page is **JS-heavy** (obfuscated); no static `m3u8` in HTML from fetch.
- **Connector strategy:** one `webplayer` per channel, URL `https://dlhd.pk/stream/stream-{id}.php` (opens in browser / Stremio external).

## Native ID

Stable slug: `{HHmm}-{slugified-title}` via `dlhdEventNativeId(title, time)`.

## API

- Documented at `https://dlhd.pk/api.php` — `daddyapi.php?key=…&endpoint=schedule` requires API key.
- Connector uses **public schedule HTML** only.

## Live probe (2026-05)

- `listEvents`: ~300+ events
- `getEventDetail`: N streams = number of channels on that row

## Env

- `DLHD_BASE_URL` — default `https://dlhd.pk`
- `SKIP_DLHD_INTEGRATION=1` — skip live integration test in CI
