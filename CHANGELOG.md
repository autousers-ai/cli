# Changelog

All notable changes to `@autousers/cli` will be documented here.
Format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).
This project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.2.2] — 2026-05-01

### Changed — docs cleanup + provenance visibility

- **Mirror notice moved out of the README.** The "this is a read-only mirror"
  blockquote was visible on the npm package page where the audience is people
  trying to install/use the package, not contribute to it. The same content
  (expanded with security disclosure + release-process explanation) now lives
  in `CONTRIBUTING.md`, which GitHub auto-surfaces on the "New issue" and
  "New pull request" forms in `autousers-ai/cli`. `CONTRIBUTING.md` is
  intentionally not bundled in the npm tarball — it ships only to the GitHub
  mirror.
- **Provenance badge added** to the README so the SLSA attestation is more
  visible than the small green checkmark next to the version on the npm
  sidebar. Verifiable via `npm audit signatures` after install, or by
  clicking the version on the [npm package page](https://www.npmjs.com/package/@autousers/cli).

## [0.2.0] — 2026-05-01

First feature release: OAuth browser login + read-only commands.

### Added

- **`autousers login`** — browser OAuth flow by default. PKCE S256, RFC 8707
  audience binding (`<base-url>/api/v1`), localhost callback on a kernel-
  assigned port, single-use server with 5-minute timeout.
- **`autousers login --key ak_live_…`** — paste-an-API-key mode for
  headless / CI use.
- **`autousers login --no-browser`** — print the auth URL instead of
  spawning a browser (SSH / no-display environments).
- **`autousers logout`** — POST `/oauth/revoke` server-side, then wipe
  local credentials.
- **`autousers whoami`** — print the active user, team, and quota status.
- **`autousers eval list / get`** — list and inspect evaluations.
- **`autousers usage [--range 7d|30d|90d]`** — free-run pool + cost
  rollup with top-3 evals by spend.
- **`autousers autouser list [--source built-in|custom]`** — list
  calibrated AI personas.
- **`autousers template list`** — list rating templates / dimensions.
- **Global flags**: `--json`, `--quiet`, `--no-color`, `--key`,
  `--base-url`. `NO_COLOR=1` env var also respected.
- **Refresh-on-401**: client transparently refreshes OAuth access tokens
  using the stored refresh token (with in-process Promise dedupe so
  concurrent requests don't race-revoke).
- **Auth resolution precedence**: `--key` flag → `AUTOUSERS_API_KEY` env
  → OAuth access token → `apiKey` from config.
- 48 vitest tests covering OAuth flow, refresh dedupe, command output,
  and exit-code mapping.

### Changed

- `cli/src/client.ts` rewritten to support OAuth refresh in addition to
  static API keys. Public `createClientFromConfig(globalOpts)` factory
  is the canonical entry point.

## [0.1.0] — 2026-05-01

Initial scaffold; commands shipping in subsequent releases. Ships the
`autousers` bin with `--version` / `--help` wired up and placeholder
subcommands (`login`, `logout`, `whoami`, `eval`, `usage`, `version`) that
exit 64 ("command not yet implemented") so MCP hosts and shell users can
discover the surface ahead of feature rollout.
