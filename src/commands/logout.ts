/**
 * `autousers logout` — placeholder.
 *
 * The real implementation will rewrite `~/.autousers/config.json` with the
 * `apiKey` field removed (preserving any other fields like `baseUrl`) so
 * subsequent commands fall back to env or `--key`.
 */

export function logoutCommand(): void {
  process.stderr.write(
    "autousers logout: not yet implemented (shipping in a subsequent 0.1.x release).\n"
  );
  process.exit(64);
}
