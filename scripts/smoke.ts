#!/usr/bin/env tsx
/**
 * Autousers CLI smoke harness.
 *
 * Runs the BUILT bin (`dist/index.js`) with `--version` and asserts the
 * output looks sane. The point: catch the regression where a refactor
 * silently breaks the bin entry — an MCP-style end-to-end smoke for the
 * CLI surface.
 *
 * Usage:
 *   npm run smoke
 *
 * The script does NOT import from `src/`. We deliberately spawn the built
 * artifact (`dist/index.js`) so the smoke matches what `npm install -g`
 * actually puts on `$PATH`.
 */

import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const CLI_ROOT = resolve(__dirname, "..");
const BIN_ENTRY = resolve(CLI_ROOT, "dist/index.js");

if (!existsSync(BIN_ENTRY)) {
  process.stderr.write(
    [
      `Built bin not found at ${BIN_ENTRY}.`,
      "",
      "Build the CLI first:",
      "  cd cli && npm run build",
      "",
    ].join("\n")
  );
  process.exit(2);
}

interface Probe {
  args: string[];
  expectStdoutMatches: RegExp;
  expectExitCode: number;
}

const probes: Probe[] = [
  {
    args: ["--version"],
    expectStdoutMatches: /^\d+\.\d+\.\d+/,
    expectExitCode: 0,
  },
  {
    args: ["--help"],
    expectStdoutMatches: /Usage: autousers/,
    expectExitCode: 0,
  },
];

let failures = 0;

for (const probe of probes) {
  const result = spawnSync(process.execPath, [BIN_ENTRY, ...probe.args], {
    encoding: "utf8",
  });

  const stdout = result.stdout ?? "";
  const stderr = result.stderr ?? "";
  const exitCode = result.status ?? -1;
  const matched = probe.expectStdoutMatches.test(stdout);
  const codeOk = exitCode === probe.expectExitCode;
  const passed = matched && codeOk;

  const icon = passed ? "PASS" : "FAIL";
  const label = `autousers ${probe.args.join(" ")}`;
  process.stdout.write(`[${icon}] ${label} (exit ${exitCode})\n`);

  if (!passed) {
    failures += 1;
    process.stdout.write(
      `  expected stdout to match ${probe.expectStdoutMatches}\n`
    );
    process.stdout.write(
      `  got stdout: ${JSON.stringify(stdout.slice(0, 200))}\n`
    );
    if (stderr.length > 0) {
      process.stdout.write(
        `  stderr: ${JSON.stringify(stderr.slice(0, 200))}\n`
      );
    }
  }
}

process.stdout.write(
  `\n${probes.length} probes, ${probes.length - failures} passed, ${failures} failed.\n`
);
process.exit(failures > 0 ? 1 : 0);
