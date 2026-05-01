/**
 * `autousers eval` — placeholder for the evaluation subcommand group.
 *
 * Will host `eval list`, `eval get`, `eval create`, `eval results`, etc.
 * once the API surface is wired up. Mirrors the `evaluations_*` MCP tools
 * one-for-one so muscle memory transfers between the two packages.
 */

export function evalCommand(): void {
  process.stderr.write(
    "autousers eval: not yet implemented (shipping in a subsequent 0.1.x release).\n"
  );
  process.exit(64);
}
