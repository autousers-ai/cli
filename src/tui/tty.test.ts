import { describe, it, expect, afterEach } from "vitest";

import { shouldUseTUI, getTerminalWidth, isWideTerminal } from "./tty.js";

describe("shouldUseTUI", () => {
  const originalIsTTY = process.stdout.isTTY;
  const originalCI = process.env.CI;
  const originalArgv = process.argv;

  afterEach(() => {
    Object.defineProperty(process.stdout, "isTTY", {
      value: originalIsTTY,
      writable: true,
    });
    if (originalCI === undefined) delete process.env.CI;
    else process.env.CI = originalCI;
    process.argv = originalArgv;
  });

  function makeTTY() {
    Object.defineProperty(process.stdout, "isTTY", {
      value: true,
      writable: true,
    });
    delete process.env.CI;
  }

  it("returns false when not a TTY", () => {
    Object.defineProperty(process.stdout, "isTTY", {
      value: false,
      writable: true,
    });
    delete process.env.CI;
    process.argv = ["node", "script.js"];
    expect(shouldUseTUI()).toBe(false);
  });

  it("returns false when CI is set", () => {
    makeTTY();
    process.env.CI = "true";
    process.argv = ["node", "script.js"];
    expect(shouldUseTUI()).toBe(false);
  });

  it("returns false when --no-tui flag is present", () => {
    makeTTY();
    process.argv = ["node", "script.js", "--no-tui"];
    expect(shouldUseTUI()).toBe(false);
  });

  it("returns false when a subcommand is present", () => {
    makeTTY();
    process.argv = ["node", "script.js", "eval", "list"];
    expect(shouldUseTUI()).toBe(false);
  });

  it("returns false when a subcommand follows a global flag", () => {
    makeTTY();
    process.argv = ["node", "script.js", "--json", "eval", "list"];
    expect(shouldUseTUI()).toBe(false);
  });

  it("returns false when --help is present", () => {
    makeTTY();
    process.argv = ["node", "script.js", "--help"];
    expect(shouldUseTUI()).toBe(false);
  });

  it("returns false when --version is present", () => {
    makeTTY();
    process.argv = ["node", "script.js", "--version"];
    expect(shouldUseTUI()).toBe(false);
  });

  it("returns true on a bare invocation in a TTY (no subcommand, no CI, no --no-tui)", () => {
    makeTTY();
    process.argv = ["node", "script.js"];
    expect(shouldUseTUI()).toBe(true);
  });

  it("returns true with only global non-help flags", () => {
    makeTTY();
    process.argv = ["node", "script.js", "--no-color"];
    expect(shouldUseTUI()).toBe(true);
  });
});

describe("getTerminalWidth", () => {
  const originalColumns = process.stdout.columns;

  afterEach(() => {
    Object.defineProperty(process.stdout, "columns", {
      value: originalColumns,
      writable: true,
    });
  });

  it("returns process.stdout.columns when available", () => {
    Object.defineProperty(process.stdout, "columns", {
      value: 120,
      writable: true,
    });
    expect(getTerminalWidth()).toBe(120);
  });

  it("returns 80 when columns is undefined", () => {
    Object.defineProperty(process.stdout, "columns", {
      value: undefined,
      writable: true,
    });
    expect(getTerminalWidth()).toBe(80);
  });

  it("returns 80 when columns is 0", () => {
    Object.defineProperty(process.stdout, "columns", {
      value: 0,
      writable: true,
    });
    expect(getTerminalWidth()).toBe(80);
  });
});

describe("isWideTerminal", () => {
  const originalColumns = process.stdout.columns;

  afterEach(() => {
    Object.defineProperty(process.stdout, "columns", {
      value: originalColumns,
      writable: true,
    });
  });

  it("returns true at exactly 100 columns", () => {
    Object.defineProperty(process.stdout, "columns", {
      value: 100,
      writable: true,
    });
    expect(isWideTerminal()).toBe(true);
  });

  it("returns true above 100 columns", () => {
    Object.defineProperty(process.stdout, "columns", {
      value: 200,
      writable: true,
    });
    expect(isWideTerminal()).toBe(true);
  });

  it("returns false below 100 columns", () => {
    Object.defineProperty(process.stdout, "columns", {
      value: 99,
      writable: true,
    });
    expect(isWideTerminal()).toBe(false);
  });
});
