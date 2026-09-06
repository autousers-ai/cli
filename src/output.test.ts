/**
 * Tests for the formatting helpers in `output.ts`.
 *
 * The renderers are pure functions (modulo the global color toggle), so
 * the tests are deterministic without a TTY. We force color OFF in
 * `beforeEach` so snapshot output isn't peppered with ANSI codes — the
 * color logic itself is covered separately by enabling it in a single
 * focused test.
 */

import { beforeEach, describe, expect, it } from "vitest";

import {
  bold,
  dim,
  isColorEnabled,
  json,
  kv,
  red,
  relativeTime,
  setColorEnabled,
  shortId,
  table,
  truncate,
} from "./output.js";

beforeEach(() => {
  // Default off so the assertions on string content stay readable.
  setColorEnabled(false);
});

describe("color helpers", () => {
  it("are pass-through when color is disabled", () => {
    setColorEnabled(false);
    expect(bold("x")).toBe("x");
    expect(dim("x")).toBe("x");
    expect(red("x")).toBe("x");
  });

  it("emit ANSI codes when color is enabled", () => {
    setColorEnabled(true);
    expect(bold("x")).toBe("\x1b[1mx\x1b[22m");
    expect(red("x")).toBe("\x1b[31mx\x1b[39m");
    setColorEnabled(false);
  });

  it("setColorEnabled / isColorEnabled round-trip", () => {
    setColorEnabled(true);
    expect(isColorEnabled()).toBe(true);
    setColorEnabled(false);
    expect(isColorEnabled()).toBe(false);
  });
});

describe("table", () => {
  it("aligns columns to the widest cell (header or body)", () => {
    const out = table(
      [
        { ID: "abc", Name: "alpha" },
        { ID: "defghi", Name: "b" },
      ],
      ["ID", "Name"]
    );
    const lines = out.split("\n");
    expect(lines).toHaveLength(3); // header + 2 rows
    // "defghi" is 6 chars, longer than "ID" (2). Columns separated by 2 spaces.
    expect(lines[0]).toBe("ID      Name ");
    expect(lines[1]).toBe("abc     alpha");
    expect(lines[2]).toBe("defghi  b    ");
  });

  it("renders an empty placeholder when no rows", () => {
    expect(table([], ["A", "B"])).toBe("(no rows)");
  });

  it("treats undefined / null cells as blanks", () => {
    const out = table(
      [{ A: "x", B: undefined as unknown as string }],
      ["A", "B"]
    );
    expect(out).toContain("x");
    // No "undefined" or "null" leaking into the rendered text.
    expect(out).not.toContain("undefined");
    expect(out).not.toContain("null");
  });
});

describe("kv", () => {
  it("aligns keys to the widest key", () => {
    const out = kv({ Short: "a", LongerKey: "b" });
    const lines = out.split("\n");
    expect(lines).toHaveLength(2);
    // Both lines start with two spaces of indent.
    expect(lines[0]?.startsWith("  ")).toBe(true);
    expect(lines[1]?.startsWith("  ")).toBe(true);
    // Both values are present.
    expect(out).toContain("a");
    expect(out).toContain("b");
  });

  it("returns an empty string for empty input", () => {
    expect(kv({})).toBe("");
  });
});

describe("json", () => {
  it("pretty-prints with 2-space indent", () => {
    expect(json({ a: 1, b: [2, 3] })).toBe(
      `{\n  "a": 1,\n  "b": [\n    2,\n    3\n  ]\n}`
    );
  });
});

describe("relativeTime", () => {
  it("returns em-dash for null/undefined", () => {
    expect(relativeTime(null)).toBe("—");
    expect(relativeTime(undefined)).toBe("—");
  });

  it("formats minute-scale recency", () => {
    const fiveMinAgo = new Date(Date.now() - 5 * 60 * 1000);
    expect(relativeTime(fiveMinAgo)).toBe("5m ago");
  });

  it("formats hour-scale recency", () => {
    const twoHrAgo = new Date(Date.now() - 2 * 60 * 60 * 1000);
    expect(relativeTime(twoHrAgo)).toBe("2h ago");
  });

  it("formats yesterday", () => {
    const oneDayAgo = new Date(Date.now() - 26 * 60 * 60 * 1000);
    // Rounded to 1 day → "yesterday"
    expect(relativeTime(oneDayAgo)).toBe("yesterday");
  });

  it("formats day-scale recency", () => {
    const fiveDaysAgo = new Date(Date.now() - 5 * 24 * 60 * 60 * 1000);
    expect(relativeTime(fiveDaysAgo)).toBe("5d ago");
  });
});

describe("truncate / shortId", () => {
  it("truncates long strings with an ellipsis", () => {
    expect(truncate("0123456789", 6)).toBe("01234…");
    expect(truncate("short", 10)).toBe("short");
  });

  it("shortens cuid-style ids to 8+ellipsis", () => {
    expect(shortId("cmoi1234567890")).toBe("cmoi1234…");
    expect(shortId("abc")).toBe("abc");
  });
});
