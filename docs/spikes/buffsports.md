# Spike: buffsports.io

## URLs

- List (soccer): `https://buffsports.io/watch-soccer`
- Event: `https://buffsports.io/soccer/live-{slug}`

## List page (SSR)

- Events are **server-rendered** in `#e6u5r8b2t8` as `<a href="/soccer/live-…">` cards.
- Metadata: `title` attribute, `span[content]` ISO datetime (`2026-05-18T20:00`), country in `span.buffstreams.soccer.{country}`.
- **Live** events use Bootstrap class `text-primary` on the anchor (not a separate badge).
- Date headers: `motion.div` with class `r3i9c2a8x2` showing `YYYY-MM-DD`.

## Event / player page

- Heavy **obfuscated JavaScript** loads the player client-side.
- No reliable `m3u8` or `iframe` in initial HTML (curl/Bun fetch).
- **Connector strategy:** `getEventDetail` returns a `webplayer` stream pointing at the event page URL (browser playback). Optional iframe/m3u8 regex if present in HTML.

## Native ID

Path without leading slash, e.g. `soccer/live-arsenal-vs-burnley`.

## Live probe (2026-05)

- `listEvents`: ~50 soccer rows
- `getEventDetail`: 1 stream (page fallback)

## Env

- `BUFFSPORTS_BASE_URL` — default `https://buffsports.io`
- `SKIP_BUFFSPORTS_INTEGRATION=1` — skip live integration test in CI
