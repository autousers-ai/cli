/**
 * `autousers version` — explicit subcommand form of `--version`.
 *
 * Prints `autousers/<version> (node <node>, <platform>)` so support tickets
 * carry enough environment context to debug install issues without a
 * follow-up round-trip. Same format Heroku, Stripe, and gh use.
 */

import { CLI_VERSION } from "../client.js";

export function versionCommand(): void {
  const line = `autousers/${CLI_VERSION} (node ${process.version}, ${process.platform})`;
  process.stdout.write(`${line}\n`);
}
