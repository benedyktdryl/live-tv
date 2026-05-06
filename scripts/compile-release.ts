#!/usr/bin/env bun
/**
 * Cross-compile livetv + livetv-supervisor for release targets (requires host Bun with compile support).
 */
import { mkdirSync } from "node:fs";

const rows: readonly (readonly [string, string, string])[] = [
  ["bun-darwin-arm64", "livetv-darwin-arm64", "livetv-supervisor-darwin-arm64"],
  ["bun-darwin-x64", "livetv-darwin-x64", "livetv-supervisor-darwin-x64"],
  ["bun-linux-x64", "livetv-linux-x64", "livetv-supervisor-linux-x64"],
  ["bun-windows-x64", "livetv-windows-x64.exe", "livetv-supervisor-windows-x64.exe"],
];

mkdirSync("dist", { recursive: true });

function run(args: string[]): void {
  const proc = Bun.spawnSync(args, { stdout: "inherit", stderr: "inherit" });
  if (proc.exitCode !== 0) {
    console.error("Command failed:", args.join(" "));
    process.exit(proc.exitCode ?? 1);
  }
}

for (const [target, cliOut, supOut] of rows) {
  console.log(`\n--- ${target} ---\n`);
  run([
    "bun",
    "build",
    "packages/cli/src/index.ts",
    "--compile",
    `--target=${target}`,
    `--outfile=dist/${cliOut}`,
  ]);
  run([
    "bun",
    "build",
    "packages/launcher/src/index.ts",
    "--compile",
    `--target=${target}`,
    `--outfile=dist/${supOut}`,
  ]);
}

console.log("\nDone. Binaries in dist/\n");
