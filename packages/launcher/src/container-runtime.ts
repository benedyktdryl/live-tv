/** Docker or Podman — supervisor starts AceStream with whichever is available. */

export type ContainerRuntimeName = "docker" | "podman";

export type ContainerRuntime = {
  name: ContainerRuntimeName;
  bin: string;
};

export type RuntimeProbe =
  | { status: "ready"; runtime: ContainerRuntime }
  | { status: "podman-machine-stopped"; runtime: ContainerRuntime }
  | { status: "unavailable"; docker: boolean; podman: boolean };

export type CliResult = { ok: boolean; stdout: string; stderr: string; code: number };

export type WhichFn = (name: string) => string | null | undefined;
export type RunFn = (bin: string, args: string[]) => Promise<CliResult>;

export async function runContainerCli(bin: string, args: string[]): Promise<CliResult> {
  const proc = Bun.spawn([bin, ...args], { stdout: "pipe", stderr: "pipe" });
  const code = await proc.exited;
  const stdout = await new Response(proc.stdout).text();
  const stderr = await new Response(proc.stderr).text();
  return { ok: code === 0, stdout, stderr, code };
}

/** Prefer Docker when both are installed; Podman is a valid fallback. */
export function findContainerRuntimes(which: WhichFn = (n) => Bun.which(n)): ContainerRuntime[] {
  const found: ContainerRuntime[] = [];
  if (which("docker")) found.push({ name: "docker", bin: "docker" });
  if (which("podman")) found.push({ name: "podman", bin: "podman" });
  return found;
}

export function podmanUsesMachine(platform = process.platform): boolean {
  return platform === "darwin" || platform === "win32";
}

/** Parse `podman machine ls` JSON or table. */
export function parsePodmanMachineLs(stdout: string): "running" | "stopped" | "none" {
  const trimmed = stdout.trim();
  if (!trimmed) return "none";

  if (trimmed.startsWith("[") || trimmed.startsWith("{")) {
    try {
      const data = JSON.parse(trimmed) as unknown;
      const list = Array.isArray(data) ? data : [data];
      if (list.length === 0) return "none";
      return list.some(machineLooksRunning) ? "running" : "stopped";
    } catch {
      // fall through to table parse
    }
  }

  if (/currently running/i.test(trimmed)) return "running";
  const lines = trimmed
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean);
  if (lines.length <= 1 && /NAME/i.test(lines[0] ?? "")) return "none";
  if (lines.length > 1) return "stopped";
  return "none";
}

function machineLooksRunning(machine: unknown): boolean {
  if (!machine || typeof machine !== "object") return false;
  const rec = machine as Record<string, unknown>;
  if (rec.Running === true) return true;
  return typeof rec.LastUp === "string" && /currently running/i.test(rec.LastUp);
}

async function podmanMachineState(
  bin: string,
  run: RunFn,
): Promise<"running" | "stopped" | "none" | "unknown"> {
  const json = await run(bin, ["machine", "ls", "--format", "json"]);
  if (json.ok || json.stdout.trim().startsWith("[")) {
    return parsePodmanMachineLs(json.stdout);
  }
  const table = await run(bin, ["machine", "ls"]);
  if (!table.ok && !table.stdout.trim()) return "unknown";
  return parsePodmanMachineLs(table.stdout);
}

async function runtimeClientOk(bin: string, run: RunFn): Promise<boolean> {
  const r = await run(bin, ["version", "--format", "{{.Client.Version}}"]);
  return r.ok && r.stdout.trim().length > 0;
}

export async function probeContainerRuntime(
  opts: {
    which?: WhichFn;
    run?: RunFn;
    platform?: NodeJS.Platform;
  } = {},
): Promise<RuntimeProbe> {
  const which = opts.which ?? ((n: string) => Bun.which(n));
  const run = opts.run ?? runContainerCli;
  const platform = opts.platform ?? process.platform;

  const runtimes = findContainerRuntimes(which);
  const docker = runtimes.find((r) => r.name === "docker");
  const podman = runtimes.find((r) => r.name === "podman");

  if (docker && (await runtimeClientOk(docker.bin, run))) {
    return { status: "ready", runtime: docker };
  }

  if (podman) {
    if (podmanUsesMachine(platform)) {
      const machine = await podmanMachineState(podman.bin, run);
      if (machine === "running") return { status: "ready", runtime: podman };
      if (machine === "stopped" || machine === "none") {
        return { status: "podman-machine-stopped", runtime: podman };
      }
      if (!(await runtimeClientOk(podman.bin, run))) {
        return { status: "podman-machine-stopped", runtime: podman };
      }
      return { status: "ready", runtime: podman };
    }
    if (await runtimeClientOk(podman.bin, run)) {
      return { status: "ready", runtime: podman };
    }
  }

  return { status: "unavailable", docker: Boolean(docker), podman: Boolean(podman) };
}

export function missingEngineHelp(engineUrl: string, probe: RuntimeProbe): string {
  if (probe.status === "podman-machine-stopped") {
    return `
No AceStream engine at ${engineUrl} and the Podman machine is not running.

  Start an engine (examples):
    podman machine start
    podman compose up -d
    # or install from https://acestream.org

  Or set ACE_ENGINE_HOST / ACE_ENGINE_PORT if the engine uses another address.
`;
  }

  if (probe.status === "ready") return "";

  const { docker, podman } = probe;
  let headline: string;
  let examples: string;
  if (podman && !docker) {
    headline = `No AceStream engine at ${engineUrl} and Podman is not available.`;
    examples = "    podman compose up -d";
  } else if (docker && !podman) {
    headline = `No AceStream engine at ${engineUrl} and Docker is not available.`;
    examples = "    docker compose up -d";
  } else {
    headline = `No AceStream engine at ${engineUrl} and no container runtime is available.`;
    examples = "    docker compose up -d\n    # or: podman compose up -d";
  }

  return `
${headline}

  Start an engine (examples):
${examples}
    # or install from https://acestream.org

  Or set ACE_ENGINE_HOST / ACE_ENGINE_PORT if the engine uses another address.
`;
}
