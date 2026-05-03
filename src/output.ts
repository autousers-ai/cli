/**
 * Tiny formatting helpers — zero deps.
 *
 * The CLI deliberately avoids `chalk`, `cli-table3`, `ora` and friends. They
 * each pull in 2-12 transitive packages (often with prototype-pollution CVEs
 * still in the audit feed) for what amounts to a few `\x1b[` escape codes
 * and a fixed-width column join. Hand-rolling keeps `npm install -g` fast
 * (the whole CLI tree is under 100 KB unpacked) and makes the output layer
 * testable without spinning up a TTY.
 *
 * Color detection
 * ---------------
 * ANSI codes are emitted ONLY when the destination is an interactive
 * terminal AND `--no-color` / `NO_COLOR` haven't been set. We honor the
 * de-facto-standard `NO_COLOR` env var (https://no-color.org) which the
 * Vercel build, GitHub Actions, and the popular `tee log.txt` pattern all
 * already set. When piped to a file the output is therefore plain text —
 * exactly what shell users expect from a well-behaved tool.
 *
 * Spinner
 * -------
 * The braille frame set (`⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏`) is the ora default — it renders
 * crisply at any font size and survives `LANG=C` better than the Unicode
 * block alternatives. We only animate when stdout is a TTY; when piped, we
 * print the message once and skip the animation so log files don't fill
 * with carriage returns.
 */

// ────────────────────────────────────────────────────────────────────────────
// Color enable/disable
// ────────────────────────────────────────────────────────────────────────────

/**
 * Module-scoped color toggle. Defaults to `process.stdout.isTTY` — the
 * dispatcher overrides this via {@link setColorEnabled} when `--no-color`
 * is passed or `NO_COLOR=1` is in the environment. Keeping it as module
 * state (rather than a per-call argument) means the dozens of `dim()` /
 * `bold()` calls in the command renderers don't need to thread a flag.
 */
let colorEnabled: boolean =
  Boolean(process.stdout.isTTY) && !process.env.NO_COLOR;

/** Enable or disable ANSI color output globally. */
export function setColorEnabled(enabled: boolean): void {
  colorEnabled = enabled;
}

/** Read the current color-enabled state — exported for tests. */
export function isColorEnabled(): boolean {
  return colorEnabled;
}

function wrap(open: string, close: string, s: string): string {
  if (!colorEnabled) return s;
  return `\x1b[${open}m${s}\x1b[${close}m`;
}

/** Dim text — used for secondary metadata (timestamps, IDs). */
export function dim(s: string): string {
  return wrap("2", "22", s);
}

/** Bold text — used for headings. */
export function bold(s: string): string {
  return wrap("1", "22", s);
}

/** Red — used for errors. */
export function red(s: string): string {
  return wrap("31", "39", s);
}

/** Green — used for success. */
export function green(s: string): string {
  return wrap("32", "39", s);
}

/** Yellow — used for warnings. */
export function yellow(s: string): string {
  return wrap("33", "39", s);
}

// ────────────────────────────────────────────────────────────────────────────
// Table renderer
// ────────────────────────────────────────────────────────────────────────────

/**
 * Render an array of objects as a fixed-width text table. Columns are
 * sized to the widest cell (including the header). Cells longer than 80
 * chars are NOT wrapped — callers are expected to truncate beforehand
 * (e.g. eval names to 40 chars). This keeps the renderer simple and
 * predictable; word-wrapping is a separate concern.
 */
export function table(
  rows: Record<string, unknown>[],
  columns: string[]
): string {
  if (rows.length === 0) return dim("(no rows)");

  // Compute widths — header first, then each cell.
  const widths = columns.map((col) => col.length);
  const stringRows: string[][] = rows.map((row) =>
    columns.map((col, i) => {
      const v = row[col];
      const s = v === undefined || v === null ? "" : String(v);
      if (s.length > widths[i]!) widths[i] = s.length;
      return s;
    })
  );

  const sep = "  ";
  const headerLine = columns
    .map((col, i) => bold(col.padEnd(widths[i]!)))
    .join(sep);
  const bodyLines = stringRows.map((cells) =>
    cells.map((cell, i) => cell.padEnd(widths[i]!)).join(sep)
  );

  return [headerLine, ...bodyLines].join("\n");
}

// ────────────────────────────────────────────────────────────────────────────
// Key/value renderer
// ────────────────────────────────────────────────────────────────────────────

/**
 * Render a flat object as aligned `key:  value` lines. Used by `whoami`,
 * `eval get`, etc. Keys are dimmed; values are plain (so `cmd | grep`
 * still finds them by their unmodified text).
 */
export function kv(obj: Record<string, unknown>): string {
  const keys = Object.keys(obj);
  if (keys.length === 0) return "";
  const width = Math.max(...keys.map((k) => k.length));
  return keys
    .map((k) => {
      const v = obj[k];
      const valueStr = v === undefined || v === null ? "" : String(v);
      return `  ${dim((k + ":").padEnd(width + 1))}  ${valueStr}`;
    })
    .join("\n");
}

// ────────────────────────────────────────────────────────────────────────────
// JSON
// ────────────────────────────────────────────────────────────────────────────

/** Pretty-print a value as 2-space-indented JSON. */
export function json(value: unknown): string {
  return JSON.stringify(value, null, 2);
}

// ────────────────────────────────────────────────────────────────────────────
// Spinner
// ────────────────────────────────────────────────────────────────────────────

const SPINNER_FRAMES = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];

/** Handle returned by {@link spinner} — call `stop(final?)` to finalize. */
export interface SpinnerHandle {
  stop: (final?: string) => void;
}

/**
 * Show a braille spinner with `message` next to it. When stdout is not a
 * TTY (or `--quiet` is set), prints the message once and `stop()` is a
 * no-op for the animation portion — only the final text is rendered.
 */
export function spinner(message: string): SpinnerHandle {
  const isTty = Boolean(process.stdout.isTTY);

  if (!isTty) {
    return {
      stop: (final?: string) => {
        if (final !== undefined && final.length > 0) {
          process.stdout.write(`${final}\n`);
        }
      },
    };
  }

  let frame = 0;
  const render = (): void => {
    const f = SPINNER_FRAMES[frame % SPINNER_FRAMES.length]!;
    // \r returns to col 0; \x1b[K clears to end of line so a shorter
    // message after a longer one doesn't leave artifacts.
    process.stdout.write(`\r\x1b[K${f} ${message}`);
    frame += 1;
  };

  render();
  const interval = setInterval(render, 80);
  // Don't keep the event loop alive on the spinner alone — if the user
  // hits Ctrl-C the process should exit immediately.
  if (typeof interval.unref === "function") interval.unref();

  return {
    stop: (final?: string) => {
      clearInterval(interval);
      // Wipe the spinner line.
      process.stdout.write("\r\x1b[K");
      if (final !== undefined && final.length > 0) {
        process.stdout.write(`${final}\n`);
      }
    },
  };
}

// ────────────────────────────────────────────────────────────────────────────
// Time formatting
// ────────────────────────────────────────────────────────────────────────────

/**
 * Render a Date / ISO string as a coarse relative time ("2h ago",
 * "yesterday", "5d ago"). Granularity matches the `gh` CLI list views —
 * good enough for "is this stale?" without needing absolute timestamps.
 */
export function relativeTime(input: Date | string | null | undefined): string {
  if (!input) return "—";
  const d = input instanceof Date ? input : new Date(input);
  const ms = Date.now() - d.getTime();
  if (Number.isNaN(ms)) return "—";

  const sec = Math.round(ms / 1000);
  if (sec < 60) return "just now";
  const min = Math.round(sec / 60);
  if (min < 60) return `${min}m ago`;
  const hr = Math.round(min / 60);
  if (hr < 24) return `${hr}h ago`;
  const day = Math.round(hr / 24);
  if (day === 1) return "yesterday";
  if (day < 30) return `${day}d ago`;
  const mo = Math.round(day / 30);
  if (mo < 12) return `${mo}mo ago`;
  const yr = Math.round(mo / 12);
  return `${yr}y ago`;
}

// ────────────────────────────────────────────────────────────────────────────
// Misc helpers
// ────────────────────────────────────────────────────────────────────────────

/** Truncate a string to `max` chars, suffixing with `…` if it was cut. */
export function truncate(s: string, max: number): string {
  if (s.length <= max) return s;
  if (max <= 1) return "…";
  return s.slice(0, max - 1) + "…";
}

/** First 8 characters of an id, suffixed with `…`. Stable for cuids. */
export function shortId(id: string): string {
  if (id.length <= 8) return id;
  return id.slice(0, 8) + "…";
}
