/**
 * `autousers whoami` — placeholder.
 *
 * The real implementation will call `/api/v1/usage` (or a future
 * `/api/v1/me`) and print the active user's email + active team. Useful
 * mid-script to confirm the resolved key is the one you think it is.
 */

export function whoamiCommand(): void {
  process.stderr.write(
    "autousers whoami: not yet implemented (shipping in a subsequent 0.1.x release).\n"
  );
  process.exit(64);
}
