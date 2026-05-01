/**
 * `autousers login` — placeholder.
 *
 * The real implementation will prompt for an `ak_live_*` key, validate it
 * against `/api/v1/usage` (the cheapest authenticated read), and persist
 * `{ apiKey }` to `~/.autousers/config.json` via {@link writeConfig}.
 *
 * Until then we exit 64 (EX_USAGE) so callers can detect the stub
 * programmatically. Same exit code is used by every other placeholder
 * subcommand for symmetry.
 */

export function loginCommand(): void {
  process.stderr.write(
    "autousers login: not yet implemented (shipping in a subsequent 0.1.x release).\n"
  );
  process.exit(64);
}
