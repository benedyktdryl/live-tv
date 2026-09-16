import { describe, expect, test } from "bun:test";
import {
  findContainerRuntimes,
  missingEngineHelp,
  parsePodmanMachineLs,
  podmanUsesMachine,
  probeContainerRuntime,
  type CliResult,
} from "./container-runtime.js";

describe("findContainerRuntimes", () => {
  test("returns docker then podman when both exist", () => {
    const found = findContainerRuntimes((n) =>
      n === "docker" || n === "podman" ? `/usr/bin/${n}` : null,
    );
    expect(found.map((r) => r.name)).toEqual(["docker", "podman"]);
  });

  test("returns only podman when docker is missing", () => {
    const found = findContainerRuntimes((n) =>
      n === "podman" ? "/opt/homebrew/bin/podman" : null,
    );
    expect(found).toEqual([{ name: "podman", bin: "podman" }]);
  });

  test("returns empty when neither is installed", () => {
    expect(findContainerRuntimes(() => null)).toEqual([]);
  });
});

describe("podmanUsesMachine", () => {
  test("is true on macOS and Windows", () => {
    expect(podmanUsesMachine("darwin")).toBe(true);
    expect(podmanUsesMachine("win32")).toBe(true);
    expect(podmanUsesMachine("linux")).toBe(false);
  });
});

describe("parsePodmanMachineLs", () => {
  test("reads Running from JSON", () => {
    expect(parsePodmanMachineLs(JSON.stringify([{ Name: "default", Running: true }]))).toBe(
      "running",
    );
    expect(parsePodmanMachineLs(JSON.stringify([{ Name: "default", Running: false }]))).toBe(
      "stopped",
    );
    expect(parsePodmanMachineLs("[]")).toBe("none");
  });

  test("treats LastUp Currently running as running", () => {
    expect(
      parsePodmanMachineLs(JSON.stringify([{ Name: "default", LastUp: "Currently running" }])),
    ).toBe("running");
  });

  test("parses table output", () => {
    const stopped = `NAME                     VM TYPE     CREATED       LAST UP      CPUS        MEMORY      DISK SIZE
podman-machine-default*  applehv     6 months ago  11 days ago  6           6GiB        100GiB`;
    expect(parsePodmanMachineLs(stopped)).toBe("stopped");

    const running = `NAME                     VM TYPE     CREATED       LAST UP             CPUS
podman-machine-default*  applehv     6 months ago  Currently running   6`;
    expect(parsePodmanMachineLs(running)).toBe("running");

    expect(parsePodmanMachineLs("NAME        VM TYPE     CREATED     LAST UP")).toBe("none");
  });
});

const ENGINE = "http://127.0.0.1:6878";

function cli(ok: boolean, stdout = "", stderr = "", code = ok ? 0 : 125): CliResult {
  return { ok, stdout, stderr, code };
}

describe("probeContainerRuntime", () => {
  test("prefers a working docker client", async () => {
    const probe = await probeContainerRuntime({
      platform: "darwin",
      which: (n) => (n === "docker" || n === "podman" ? n : null),
      run: async (bin, args) => {
        if (bin === "docker" && args[0] === "version") return cli(true, "28.0.0\n");
        return cli(false, "", "unused");
      },
    });
    expect(probe).toEqual({ status: "ready", runtime: { name: "docker", bin: "docker" } });
  });

  test("detects a stopped Podman machine when docker is absent", async () => {
    const probe = await probeContainerRuntime({
      platform: "darwin",
      which: (n) => (n === "podman" ? "/opt/homebrew/bin/podman" : null),
      run: async (_bin, args) => {
        if (args[0] === "machine" && args[1] === "ls") {
          return cli(true, JSON.stringify([{ Name: "podman-machine-default", Running: false }]));
        }
        return cli(false, "", "Cannot connect to Podman");
      },
    });
    expect(probe.status).toBe("podman-machine-stopped");
  });

  test("detects a stopped Podman machine when docker is a dead podman shim", async () => {
    const probe = await probeContainerRuntime({
      platform: "darwin",
      which: (n) => (n === "docker" || n === "podman" ? n : null),
      run: async (bin, args) => {
        if (bin === "podman" && args[0] === "machine") {
          return cli(true, JSON.stringify([{ Name: "podman-machine-default", Running: false }]));
        }
        return cli(false, "", "Cannot connect to Podman");
      },
    });
    expect(probe.status).toBe("podman-machine-stopped");
    expect(missingEngineHelp(ENGINE, probe)).not.toContain("Docker is not available");
  });

  test("uses podman when the machine is running", async () => {
    const probe = await probeContainerRuntime({
      platform: "darwin",
      which: (n) => (n === "podman" ? "podman" : null),
      run: async (_bin, args) => {
        if (args[0] === "machine") {
          return cli(true, JSON.stringify([{ Name: "podman-machine-default", Running: true }]));
        }
        return cli(true, "5.0.0\n");
      },
    });
    expect(probe).toEqual({ status: "ready", runtime: { name: "podman", bin: "podman" } });
  });

  test("uses podman on linux without a machine check", async () => {
    const probe = await probeContainerRuntime({
      platform: "linux",
      which: (n) => (n === "podman" ? "podman" : null),
      run: async (_bin, args) => {
        if (args[0] === "version") return cli(true, "5.0.0\n");
        throw new Error(`unexpected ${args.join(" ")}`);
      },
    });
    expect(probe.status).toBe("ready");
  });
});

describe("missingEngineHelp", () => {
  test("tells the user to start the Podman machine then compose", () => {
    const msg = missingEngineHelp(ENGINE, {
      status: "podman-machine-stopped",
      runtime: { name: "podman", bin: "podman" },
    });
    expect(msg).toContain("the Podman machine is not running");
    expect(msg).toContain("podman machine start");
    expect(msg).toContain("podman compose up -d");
    expect(msg).not.toContain("Docker is not available");
  });

  test("does not blame Docker when only Podman is installed", () => {
    const msg = missingEngineHelp(ENGINE, { status: "unavailable", docker: false, podman: true });
    expect(msg).toContain("Podman is not available");
    expect(msg).not.toContain("Docker is not available");
  });

  test("mentions both runtimes when neither binary exists", () => {
    const msg = missingEngineHelp(ENGINE, { status: "unavailable", docker: false, podman: false });
    expect(msg).toContain("no container runtime is available");
    expect(msg).toContain("docker compose up -d");
    expect(msg).toContain("podman compose up -d");
  });
});
