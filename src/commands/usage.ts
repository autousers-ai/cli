/**
 * `autousers usage` — placeholder.
 *
 * Will GET `/api/v1/usage` and render the same rollup the MCP `usage_get`
 * tool surfaces (free-run pool remaining, token spend, period). Cheapest
 * authenticated call we have, so it doubles as a connectivity probe.
 */

export function usageCommand(): void {
  process.stderr.write(
    "autousers usage: not yet implemented (shipping in a subsequent 0.1.x release).\n"
  );
  process.exit(64);
}
