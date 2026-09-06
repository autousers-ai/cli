/**
 * Mode detection for the autousers CLI.
 *
 * `shouldUseTUI()` decides whether to launch the Ink-based interactive
 * TUI or fall through to commander's plain-mode dispatcher.
 *
 * Rule: TUI iff stdout is a TTY, not in CI, no `--no-tui` flag, AND there
 * is no subcommand on the argv. `autousers` alone → TUI; `autousers eval
 * list` → plain mode. This is the key behavioral change from uxrater's
 * version, which only checked the `--no-tui` flag.
 *
 * Adapted from uxrater's `cli/tty.ts`.
 */

/**
 * Return true if the user's invocation should launch the interactive TUI.
 *
 * `process.argv` shape is `[node, scriptPath, ...userArgs]`. We treat any
 * non-flag user arg (i.e. doesn't start with `-`) as a subcommand and
 * defer to plain mode. Flags-only invocations (e.g. `autousers --version`,
 * `autousers --help`) also fall through to plain mode so commander can
 * handle them — they're handled below by checking the user-arg count
 * after stripping the no-tui flag rather than the leading-character test
 * specifically. Net: only a bare `autousers` (with optional `--no-color`
 * etc. that are CLI-wide flags but not subcommands) lands in the TUI.
 */
export function shouldUseTUI(): boolean {
  if (!process.stdout.isTTY) return false;
  if (process.env.CI) return false;
  if (process.argv.includes("--no-tui")) return false;

  // Strip the node binary + script path. Anything left is user input.
  const userArgs = process.argv.slice(2);

  // If any positional (non-flag) argument is present, it's a subcommand
  // — commander should handle it in plain mode.
  const hasSubcommand = userArgs.some((arg) => !arg.startsWith("-"));
  if (hasSubcommand) return false;

  // Help/version flags also belong in plain mode — let commander render
  // them so the output stays scriptable.
  const helpOrVersion = userArgs.some((arg) =>
    ["--help", "-h", "--version", "-v"].includes(arg)
  );
  if (helpOrVersion) return false;

  return true;
}

export function getTerminalWidth(): number {
  return process.stdout.columns || 80;
}

export function isWideTerminal(): boolean {
  return getTerminalWidth() >= 100;
}
