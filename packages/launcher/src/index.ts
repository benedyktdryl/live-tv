#!/usr/bin/env bun
/**
 * Ensures an AceStream HTTP engine is reachable (default 127.0.0.1:6878), then execs the livetv CLI.
 * If the engine is down, tries Docker (see docs/ENGINE-REDISTRIBUTION.md). Does not bundle engine binaries.
 */
import { existsSync, readdirSync, realpathSync } from "node:fs";
import path from "node:path";

/** Dirs to search for livetv beside this executable (execPath and argv differ when symlinks / Bun). */
function candidateInstallDirs(): string[] {
  const dirs: string[] = [];
  const add = (candidate: string | undefined) => {
    if (!candidate) return;
    try {
      const rp = realpathSync(candidate);
      const d = path.dirname(rp);
      if (!dirs.includes(d)) dirs.push(d);
    } catch {
      // ignore missing paths
    }
  };
  add(process.execPath);
  add(process.argv[0]);
  add(process.argv[1]);
  if (dirs.length === 0) {
    dirs.push(path.dirname(process.execPath));
  }

  // macOS Gatekeeper can run the binary from a temp path that only contains the supervisor.
  // Also search the default install layout from install-livetv.sh / .ps1.
  const extra: string[] = [];
  const home = process.env.HOME;
  if (home && process.platform !== "win32") {
    extra.push(path.join(home, ".local/share/livetv/bin"));
  }
  const localAppData = process.env.LOCALAPPDATA;
  if (localAppData && process.platform === "win32") {
    extra.push(path.join(localAppData, "livetv", "bin"));
  }
  for (const d of extra) {
    if (existsSync(d) && !dirs.includes(d)) dirs.push(d);
  }

  return dirs;
}

function guessVersionedLivetvFilenames(): string[] {
  const plat = process.platform;
  const a = process.arch;
  if (plat === "darwin") {
    if (a === "arm64") return ["livetv-darwin-arm64"];
    return ["livetv-darwin-x64"];
  }
  if (plat === "linux") return ["livetv-linux-x64"];
  if (plat === "win32") return ["livetv-windows-x64.exe"];
  return [];
}

/** Find compiled livetv in one install directory (plain name, release filename, or scan). */
function findCompiledCliInDir(dir: string): string | null {
  const plain = process.platform === "win32" ? "livetv.exe" : "livetv";
  const direct = path.join(dir, plain);
  if (existsSync(direct)) return direct;

  for (const name of guessVersionedLivetvFilenames()) {
    const p = path.join(dir, name);
    if (existsSync(p)) return p;
  }

  try {
    for (const n of readdirSync(dir).sort()) {
      if (!n.startsWith("livetv")) continue;
      if (n.startsWith("livetv-supervisor")) continue;
      if (n.endsWith(".txt") || n.endsWith(".md")) continue;
      const full = path.join(dir, n);
      if (existsSync(full)) return full;
    }
  } catch {
    // ignore
  }
  return null;
}

const CONTAINER_NAME = "livetv-acestream-engine";
const DEFAULT_IMAGE = "jopsis/acestream:latest";

function engineBase(): string {
  const host = process.env.ACE_ENGINE_HOST ?? "127.0.0.1";
  const port = process.env.ACE_ENGINE_PORT ?? "6878";
  return `http://${host}:${port}`;
}

async function engineHealthy(): Promise<boolean> {
  try {
    const res = await fetch(`${engineBase()}/webui/api/service?method=get_version`, {
      signal: AbortSignal.timeout(2000),
    });
    return res.ok;
  } catch {
    return false;
  }
}

async function dockerCmd(
  args: string[],
): Promise<{ ok: boolean; stdout: string; stderr: string; code: number }> {
  const proc = Bun.spawn(["docker", ...args], { stdout: "pipe", stderr: "pipe" });
  const code = await proc.exited;
  const stdout = await new Response(proc.stdout).text();
  const stderr = await new Response(proc.stderr).text();
  return { ok: code === 0, stdout, stderr, code };
}

async function dockerUsable(): Promise<boolean> {
  const r = await dockerCmd(["version", "--format", "{{.Client.Version}}"]);
  return r.ok;
}

async function containerRunning(): Promise<boolean> {
  const r = await dockerCmd(["inspect", "-f", "{{.State.Running}}", CONTAINER_NAME]);
  if (!r.ok) return false;
  return r.stdout.trim() === "true";
}

async function containerExists(): Promise<boolean> {
  const r = await dockerCmd(["inspect", CONTAINER_NAME]);
  return r.ok;
}

async function startExistingContainer(): Promise<boolean> {
  const r = await dockerCmd(["start", CONTAINER_NAME]);
  return r.ok;
}

/** Returns whether we should docker stop on exit (we started a stopped container or created a new one). */
async function runNewContainer(image: string): Promise<{ ok: boolean; stopOnExit: boolean }> {
  const port = process.env.ACE_ENGINE_PORT ?? "6878";
  const r = await dockerCmd(["run", "-d", "--name", CONTAINER_NAME, "-p", `${port}:6878`, image]);
  if (r.ok) return { ok: true, stopOnExit: true };
  if (r.stderr.includes("already in use") || r.stderr.includes("Conflict")) {
    const started = await startExistingContainer();
    return { ok: started, stopOnExit: started };
  }
  console.error("docker run failed:\n", r.stderr || r.stdout);
  return { ok: false, stopOnExit: false };
}

async function waitForEngineReady(): Promise<boolean> {
  const deadline = Date.now() + 120_000;
  while (Date.now() < deadline) {
    if (await engineHealthy()) return true;
    await new Promise((r) => setTimeout(r, 2000));
  }
  return false;
}

/**
 * If engine is already healthy, returns { ok: true, stopOnExit: false }.
 * Otherwise tries Docker; stopOnExit is true only if we started the container this call.
 */
async function ensureEngineViaDocker(image: string): Promise<{ ok: boolean; stopOnExit: boolean }> {
  if (await engineHealthy()) return { ok: true, stopOnExit: false };
  if (!(await dockerUsable())) {
    console.error(`
No AceStream engine at ${engineBase()} and Docker is not available.

  Start an engine (examples):
    docker compose up -d
    # or install from https://acestream.org

  Or set ACE_ENGINE_HOST / ACE_ENGINE_PORT if the engine uses another address.
`);
    return { ok: false, stopOnExit: false };
  }

  if (await containerRunning()) {
    if (await waitForEngineReady()) return { ok: true, stopOnExit: false };
    console.error(`AceStream API did not become ready at ${engineBase()} within 2 minutes.`);
    return { ok: false, stopOnExit: false };
  }

  if (await containerExists()) {
    const started = await startExistingContainer();
    if (!started) {
      console.error("Could not start existing Docker container", CONTAINER_NAME);
      return { ok: false, stopOnExit: false };
    }
    if (await waitForEngineReady()) return { ok: true, stopOnExit: true };
    console.error(`AceStream API did not become ready at ${engineBase()} within 2 minutes.`);
    return { ok: false, stopOnExit: true };
  }

  console.log(`Pulling/running AceStream container (${image})…`);
  const { ok, stopOnExit } = await runNewContainer(image);
  if (!ok) return { ok: false, stopOnExit: false };
  if (await waitForEngineReady()) return { ok: true, stopOnExit };
  console.error(`AceStream API did not become ready at ${engineBase()} within 2 minutes.`);
  return { ok: false, stopOnExit };
}

function cliPathAndArgs(forwarded: string[]): { cmd: string; args: string[] } {
  if (process.env.LIVETV_CLI) {
    const raw = process.env.LIVETV_CLI;
    const parts = raw.split(/\s+/).filter(Boolean);
    return { cmd: parts[0]!, args: [...parts.slice(1), ...forwarded] };
  }

  const dirs = candidateInstallDirs();
  for (const dir of dirs) {
    const compiled = findCompiledCliInDir(dir);
    if (compiled) return { cmd: compiled, args: forwarded };
  }

  const dir = dirs[0] ?? path.dirname(process.execPath);
  const devCli = path.join(dir, "packages", "cli", "src", "index.ts");
  if (existsSync(devCli)) {
    return { cmd: Bun.which("bun") ?? "bun", args: [devCli, ...forwarded] };
  }

  const fallback = path.join(process.cwd(), "packages", "cli", "src", "index.ts");
  if (existsSync(fallback)) {
    return { cmd: Bun.which("bun") ?? "bun", args: [fallback, ...forwarded] };
  }

  const plain = process.platform === "win32" ? "livetv.exe" : "livetv";
  const tried = dirs.length ? dirs.join(", ") : path.dirname(process.execPath);
  console.error(
    `Could not find livetv CLI (looked for ${plain} or ${guessVersionedLivetvFilenames().join(" / ")} in: ${tried}).\n` +
      `Re-run the install script, or set LIVETV_CLI to your livetv binary path.`,
  );
  process.exit(1);
}

async function stopOurContainer(): Promise<void> {
  const r = await dockerCmd(["inspect", CONTAINER_NAME]);
  if (!r.ok) return;
  await dockerCmd(["stop", "-t", "15", CONTAINER_NAME]);
}

function printSupervisorHelp(): void {
  console.log(`livetv-supervisor — start AceStream (Docker) if needed, then run livetv

Usage:
  livetv-supervisor [same arguments as livetv]

Environment:
  ACE_ENGINE_HOST           default 127.0.0.1
  ACE_ENGINE_PORT           default 6878
  ACESTREAM_DOCKER_IMAGE    default ${DEFAULT_IMAGE}
  LIVETV_CLI                override path to livetv (space-separated command prefix allowed)
  LIVETV_SKIP_DOCKER        if 1 or true, require an already-running engine (no docker run/start)

Docker:
  Uses container name "${CONTAINER_NAME}".
  On exit, stops this container only if the supervisor started it (docker run) or started a
  stopped container (docker start) in this session — not if the engine was already healthy
  when the supervisor launched.

See docs/ENGINE-REDISTRIBUTION.md for licensing notes.
`);
}

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  if (argv[0] === "--supervisor-help") {
    printSupervisorHelp();
    process.exit(0);
  }

  const skipDocker =
    process.env.LIVETV_SKIP_DOCKER === "1" || process.env.LIVETV_SKIP_DOCKER === "true";

  let stopContainerOnExit = false;

  if (await engineHealthy()) {
    // Engine already up — do not touch Docker on exit
  } else if (!skipDocker) {
    const image = process.env.ACESTREAM_DOCKER_IMAGE ?? DEFAULT_IMAGE;
    const { ok, stopOnExit } = await ensureEngineViaDocker(image);
    if (!ok) process.exit(1);
    stopContainerOnExit = stopOnExit;
  } else {
    console.error(`No engine at ${engineBase()} and LIVETV_SKIP_DOCKER is set.`);
    process.exit(1);
  }

  const { cmd, args } = cliPathAndArgs(argv);

  const cleanup = async () => {
    if (stopContainerOnExit) await stopOurContainer();
  };

  const proc = Bun.spawn([cmd, ...args], {
    stdin: "inherit",
    stdout: "inherit",
    stderr: "inherit",
    env: process.env,
  });

  const onSignal = async () => {
    proc.kill("SIGINT");
    await cleanup();
    process.exit(130);
  };
  process.on("SIGINT", onSignal);
  process.on("SIGTERM", onSignal);

  const code = await proc.exited;
  process.off("SIGINT", onSignal);
  process.off("SIGTERM", onSignal);

  await cleanup();
  process.exit(code === null ? 1 : code);
}

await main();
