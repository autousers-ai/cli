/**
 * Tests for `autousers completion <bash|zsh|fish>`.
 *
 * Covers per-shell shebang/keyword sniffing, top-level command coverage,
 * and the validation exit code for an unknown shell argument. We don't
 * try to *exec* the generated scripts here — that would require wiring
 * up real shells in CI; instead we sniff the structural anchors
 * (`#compdef autousers`, `_autousers()`, `complete -c autousers`) that
 * each shell looks for at load time.
 *
 * We construct a faux program tree mirroring `buildProgram()` rather than
 * importing `../index.js` directly: the latter has a top-level
 * `main().catch(...)` that runs on import and would fight the test
 * runner.
 */
import { Command } from "commander";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { completionCommand } from "./completion.js";

/** Mirror the registered top-level commands from `src/index.ts`. */
const TOP_LEVEL = [
  "login",
  "logout",
  "whoami",
  "eval",
  "autouser",
  "template",
  "dimension",
  "team",
  "settings",
  "key",
  "usage",
  "version",
];

/** A representative slice of nested subcommands for coverage assertions. */
const NESTED: Record<string, string[]> = {
  eval: ["list", "get", "create", "delete"],
  autouser: ["list", "calibrate", "freeze"],
  template: ["list", "create"],
};

function makeProgram(): Command {
  const program = new Command();
  program.exitOverride();
  program.option("--key <ak_live_...>");
  program.option("--base-url <url>");
  program.option("--json");
  program.option("--quiet");
  program.option("--no-color");

  for (const name of TOP_LEVEL) {
    const sub = program.command(name).description(`stub for ${name}`);
    const children = NESTED[name];
    if (children) {
      for (const child of children) {
        sub
          .command(child)
          .description(`stub for ${name} ${child}`)
          .action(() => undefined);
      }
    } else {
      sub.action(() => undefined);
    }
  }

  completionCommand(program);
  return program;
}

let stdoutSpy: ReturnType<typeof vi.spyOn>;
let stderrSpy: ReturnType<typeof vi.spyOn>;
let exitSpy: ReturnType<typeof vi.spyOn>;
let writes: string[];
let errs: string[];

beforeEach(() => {
  writes = [];
  errs = [];
  stdoutSpy = vi
    .spyOn(process.stdout, "write")
    .mockImplementation((chunk: string | Uint8Array): boolean => {
      writes.push(
        typeof chunk === "string" ? chunk : Buffer.from(chunk).toString()
      );
      return true;
    });
  stderrSpy = vi
    .spyOn(process.stderr, "write")
    .mockImplementation((chunk: string | Uint8Array): boolean => {
      errs.push(
        typeof chunk === "string" ? chunk : Buffer.from(chunk).toString()
      );
      return true;
    });
  exitSpy = vi.spyOn(process, "exit").mockImplementation(((code?: number) => {
    throw new Error(`__exit_${code ?? 0}__`);
  }) as never);
});

afterEach(() => {
  stdoutSpy.mockRestore();
  stderrSpy.mockRestore();
  exitSpy.mockRestore();
  vi.restoreAllMocks();
});

describe("completion", () => {
  it("emits a #compdef header for zsh", async () => {
    const program = makeProgram();
    await program.parseAsync(["node", "test", "completion", "zsh"]);
    const out = writes.join("");
    expect(out.startsWith("#compdef autousers")).toBe(true);
    expect(out).toContain("_autousers");
  });

  it("emits a _autousers() function for bash", async () => {
    const program = makeProgram();
    await program.parseAsync(["node", "test", "completion", "bash"]);
    const out = writes.join("");
    expect(out).toContain("_autousers()");
    expect(out).toContain("complete -F _autousers autousers");
  });

  it("emits `complete -c autousers` lines for fish", async () => {
    const program = makeProgram();
    await program.parseAsync(["node", "test", "completion", "fish"]);
    const out = writes.join("");
    expect(out).toContain("complete -c autousers");
  });

  it("mentions every top-level command in the generated script", async () => {
    const program = makeProgram();
    await program.parseAsync(["node", "test", "completion", "bash"]);
    const out = writes.join("");
    const expected = [...TOP_LEVEL, "completion"];
    for (const name of expected) {
      expect(out, `bash script should mention "${name}"`).toContain(name);
    }
  });

  it("includes well-known nested subcommands (eval list, autouser calibrate)", async () => {
    const program = makeProgram();
    await program.parseAsync(["node", "test", "completion", "zsh"]);
    const out = writes.join("");
    expect(out).toContain("list");
    expect(out).toContain("calibrate");
  });

  it("exits with code 4 (validation) on an unknown shell and prints to stderr", async () => {
    const program = makeProgram();
    let thrown: unknown = null;
    try {
      await program.parseAsync(["node", "test", "completion", "powershell"]);
    } catch (err) {
      thrown = err;
    }
    expect(thrown).toBeInstanceOf(Error);
    expect((thrown as Error).message).toBe("__exit_4__");
    const errOut = errs.join("");
    expect(errOut).toContain("unknown shell");
    expect(errOut).toContain("powershell");
  });
});
