/**
 * Centralized error → exit-code mapping for the CLI.
 *
 * Why pull this out of `src/index.ts`?
 * ------------------------------------
 * Subcommands run as commander callbacks; if one of them throws, commander
 * happily logs the stack and exits 1. That's a poor UX — `autousers eval get
 * <bad-id>` should exit 3 (not found), `autousers whoami` against an
 * unauthenticated key should exit 2 (auth), etc. Each command wraps its
 * body in `try/catch` and pipes the error through {@link handleError},
 * which also keeps the dispatcher in `index.ts` thin (it only handles
 * uncaught errors that escape a subcommand entirely).
 *
 * Exit codes follow `sysexits.h` for the bits where it's well-defined
 * (64 = EX_USAGE for argv-parse failures), and roll our own 2/3/4 for the
 * common API-driven outcomes — the same codes `gh`, `vercel`, and
 * `stripe` use, so users with muscle memory from those tools get the
 * behavior they expect.
 */

import { AutousersApiError, MissingApiKeyError } from "../errors.js";
import { red } from "../output.js";

/** Numeric exit codes — kept as a `const` enum-like object for clarity. */
export const ExitCode = {
  /** Success. */
  OK: 0,
  /** Generic / unknown failure. */
  GENERIC: 1,
  /** No / invalid auth — user should run `autousers login`. */
  AUTH: 2,
  /** Resource not found (404). */
  NOT_FOUND: 3,
  /** Validation / 4xx (other than 401/404). */
  VALIDATION: 4,
  /** Argv-parse / usage error — matches `sysexits.h:EX_USAGE`. */
  USAGE: 64,
} as const;

/**
 * Format a single error line. Includes the request id when present so
 * users can paste it into a support ticket without an extra round-trip.
 */
function formatLine(message: string, requestId?: string | null): string {
  const trailer = requestId ? ` (request_id: ${requestId})` : "";
  return red(`error: ${message}${trailer}`);
}

/**
 * Print `err` to stderr and exit with the appropriate code. Always exits
 * — the return type is `never` so TypeScript narrows correctly when
 * called inside a catch block.
 */
export function handleError(err: unknown): never {
  if (err instanceof MissingApiKeyError) {
    // 401 path also routes here (the client throws MissingApiKeyError on
    // 401 by design — same hint either way).
    process.stderr.write(`${formatLine(err.message)}\n`);
    process.stderr.write(`Run \`autousers login\` to mint an API key.\n`);
    process.exit(ExitCode.AUTH);
  }

  if (err instanceof AutousersApiError) {
    if (err.status === 401) {
      process.stderr.write(`${formatLine(err.message, err.requestId)}\n`);
      process.stderr.write(`Run \`autousers login\` to mint an API key.\n`);
      process.exit(ExitCode.AUTH);
    }
    if (err.status === 404) {
      process.stderr.write(`${formatLine(err.message, err.requestId)}\n`);
      process.exit(ExitCode.NOT_FOUND);
    }
    if (err.status >= 400 && err.status < 500) {
      process.stderr.write(`${formatLine(err.message, err.requestId)}\n`);
      process.exit(ExitCode.VALIDATION);
    }
    // 5xx and anything else — generic failure with the upstream id.
    process.stderr.write(`${formatLine(err.message, err.requestId)}\n`);
    process.exit(ExitCode.GENERIC);
  }

  const message = err instanceof Error ? err.message : String(err);
  process.stderr.write(`${formatLine(message)}\n`);
  process.exit(ExitCode.GENERIC);
}
