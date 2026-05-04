#!/usr/bin/env bun
import * as p from "@clack/prompts";
import {
  fetchEvents,
  fetchEventDetail,
  resolveStreamsAsync,
  bestVlcUrl,
  bestBrowserUrl,
  isAceEngineAvailable,
} from "@live-tv/core";

// ─── Helpers ──────────────────────────────────────────────────────────────────

function formatEvent(event: Awaited<ReturnType<typeof fetchEvents>>[number]): string {
  const parts: string[] = [];
  if (event.time) parts.push(event.time);
  parts.push(event.name);
  if (event.score) parts.push(`[${event.score}]`);
  if (event.sport) parts.push(`(${event.sport})`);
  if (event.isLive) parts.push("🔴");
  return parts.join("  ");
}

async function openVlc(url: string): Promise<void> {
  const vlcPaths = [
    "/Applications/VLC.app/Contents/MacOS/VLC",
    "/usr/bin/vlc",
    "/usr/local/bin/vlc",
    "vlc",
  ];

  for (const vlc of vlcPaths) {
    try {
      const proc = Bun.spawn([vlc, url], {
        stdout: "ignore",
        stderr: "ignore",
        stdin: "ignore",
      });
      // Give it 500ms to see if it fails to launch
      await new Promise((r) => setTimeout(r, 500));
      if (proc.exitCode === null) {
        console.log(`\n▶  Opened VLC: ${url}\n`);
        return;
      }
    } catch {
      // Try next path
    }
  }
  console.error("\n✗ Could not find VLC. Install it or open this URL manually:");
  console.error(`  ${url}\n`);
}

async function openBrowser(url: string): Promise<void> {
  const openers = process.platform === "darwin" ? ["open"] : ["xdg-open", "sensible-browser"];
  for (const opener of openers) {
    try {
      Bun.spawn([opener, url], { stdout: "ignore", stderr: "ignore", stdin: "ignore" });
      console.log(`\n🌐  Opened in browser: ${url}\n`);
      return;
    } catch {
      // Try next opener
    }
  }
  console.log(`\n🌐  Open this URL in your browser:\n  ${url}\n`);
}

// ─── Non-interactive commands ─────────────────────────────────────────────────

async function cmdList() {
  const events = await fetchEvents();
  console.log(JSON.stringify(events, null, 2));
}

async function cmdWatch(eventId: string) {
  const detail = await fetchEventDetail(eventId);
  if (!detail) {
    console.error(`Event ${eventId} not found`);
    process.exit(1);
  }
  const vlcUrl = bestVlcUrl(detail.streams);
  if (vlcUrl) {
    await openVlc(vlcUrl);
    return;
  }
  const browserUrl = bestBrowserUrl(detail.streams);
  if (browserUrl) {
    console.log("No AceStream/YouTube found — opening web embed in browser:");
    await openBrowser(browserUrl);
    return;
  }
  console.error("No playable stream found for this event");
  process.exit(1);
}

async function cmdStreams(eventId: string) {
  const detail = await fetchEventDetail(eventId);
  if (!detail) {
    console.error(`Event ${eventId} not found`);
    process.exit(1);
  }
  // Use async version to attempt HLS extraction for web embeds
  const resolved = await resolveStreamsAsync(detail.streams);
  console.log(JSON.stringify(resolved, null, 2));
}

// ─── Interactive mode ─────────────────────────────────────────────────────────

async function interactive() {
  p.intro("LiveTV.sx — Sports Stream Picker");

  // Check AceStream engine
  const aceAvailable = await isAceEngineAvailable();
  if (!aceAvailable) {
    p.log.warn(
      "AceStream engine not detected at localhost:6878.\n" +
        "  Most streams require it. Start it with:\n" +
        "  docker run -p 6878:6878 acestream/acestream-engine",
    );
  }

  const s = p.spinner();
  s.start("Fetching live events…");
  let events: Awaited<ReturnType<typeof fetchEvents>>;
  try {
    events = await fetchEvents();
    s.stop(`Found ${events.length} events`);
  } catch (err) {
    s.stop("Failed to fetch events");
    p.log.error(String(err));
    process.exit(1);
  }

  if (events.length === 0) {
    p.log.warn("No events found. Try again later.");
    process.exit(0);
  }

  // Show live events first
  const sorted = [...events].sort((a, b) => {
    if (a.isLive && !b.isLive) return -1;
    if (!a.isLive && b.isLive) return 1;
    return a.time.localeCompare(b.time);
  });

  const eventChoice = await p.select({
    message: "Select an event to watch:",
    options: sorted.map((e) => ({
      value: e.id,
      label: formatEvent(e),
    })),
  });

  if (p.isCancel(eventChoice)) {
    p.cancel("Cancelled.");
    process.exit(0);
  }

  s.start("Fetching stream links…");
  let detail: Awaited<ReturnType<typeof fetchEventDetail>>;
  try {
    detail = await fetchEventDetail(eventChoice as string);
    s.stop(detail ? `Found ${detail.streams.length} stream(s)` : "No detail found");
  } catch (err) {
    s.stop("Failed to fetch streams");
    p.log.error(String(err));
    process.exit(1);
  }

  if (!detail || detail.streams.length === 0) {
    p.log.warn("No streams available yet. Check back closer to event start time.");
    process.exit(0);
  }

  const hasWebEmbeds = detail.streams.some((s) => s.type === "webplayer");
  if (hasWebEmbeds) s.start("Extracting HLS from web embeds…");
  const resolved = await resolveStreamsAsync(detail.streams);
  if (hasWebEmbeds) s.stop("Done");

  const streamChoice = await p.select({
    message: "Select a stream:",
    options: resolved.map((s, i) => ({
      value: i,
      label: s.isExternal ? `🌐 ${s.name}` : `▶  ${s.name}`,
      hint: s.description,
    })),
  });

  if (p.isCancel(streamChoice)) {
    p.cancel("Cancelled.");
    process.exit(0);
  }

  const chosen = resolved[streamChoice as number];

  // Web embed — open in browser, not VLC
  if (chosen.isExternal) {
    await openBrowser(chosen.url);
  } else if (chosen.url.startsWith("acestream://")) {
    if (!aceAvailable) {
      p.log.warn("AceStream engine not running — trying system acestream:// URI handler…");
      await openBrowser(chosen.url);
    } else {
      const hash = chosen.url.replace("acestream://", "");
      const httpUrl = `http://127.0.0.1:6878/ace/getstream?content_id=${hash}`;
      await openVlc(httpUrl);
    }
  } else {
    await openVlc(chosen.url);
  }

  p.outro("Enjoy the match!");
}

// ─── Entry point ─────────────────────────────────────────────────────────────

const [, , command, ...args] = process.argv;

switch (command) {
  case "list":
    await cmdList();
    break;
  case "watch":
    if (!args[0]) {
      console.error("Usage: livetv watch <event-id>");
      process.exit(1);
    }
    await cmdWatch(args[0]);
    break;
  case "streams":
    if (!args[0]) {
      console.error("Usage: livetv streams <event-id>");
      process.exit(1);
    }
    await cmdStreams(args[0]);
    break;
  default:
    await interactive();
}
