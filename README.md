# @autousers/cli

Official command-line interface for [Autousers](https://autousers.ai) — run UX
evaluations, kick off autouser runs, and inspect calibration from your
terminal. Same `ak_live_*` API key as [`@autousers/mcp`](https://www.npmjs.com/package/@autousers/mcp).

[![npm version](https://img.shields.io/npm/v/@autousers/cli)](https://www.npmjs.com/package/@autousers/cli)
[![MIT licensed](https://img.shields.io/npm/l/@autousers/cli)](./LICENSE)

---

## Install

```bash
npm install -g @autousers/cli
```

Or invoke without installing:

```bash
npx -y @autousers/cli --help
```

Requires Node.js 20 or newer.

---

## Authenticate

### Browser login (default)

```bash
autousers login
```

Opens your default browser, signs you in to autousers.ai, and persists a
short-lived OAuth access token + refresh token to `~/.autousers/config.json`.
Same UX as `claude /mcp` — no API key to copy. The CLI refreshes the token
silently when it expires.

If you're on SSH or a no-display environment:

```bash
autousers login --no-browser
```

The CLI prints the auth URL; open it on a machine that has a browser, sign
in, and the localhost callback resolves once you complete consent.

### API key (paste / CI / headless)

Mint a key at
[app.autousers.ai/settings/api-keys](https://app.autousers.ai/settings/api-keys)
— keys are shown **once**, so paste it into a secrets manager immediately.

```bash
autousers login --key ak_live_...
```

Or supply via env (best for CI):

```bash
export AUTOUSERS_API_KEY=ak_live_...
autousers eval list   # no `login` step needed
```

### Resolution precedence

The CLI walks these in order, first match wins:

1. **`--key ak_live_...`** — explicit per-invocation flag
2. **`AUTOUSERS_API_KEY=ak_live_...`** — environment variable
3. **OAuth access token** in `~/.autousers/config.json` (auto-refreshed)
4. **`apiKey`** in `~/.autousers/config.json`

To override the API host (self-hosted / local dev):

```bash
export AUTOUSERS_BASE_URL=http://localhost:3000
```

Default: `https://app.autousers.ai`.

---

## Quickstart

```bash
autousers login                       # browser OAuth flow
autousers whoami                      # confirm the active user / team
autousers eval list                   # list your evaluations
autousers eval get <id>               # detailed eval view
autousers autouser list               # list calibrated personas
autousers template list               # list rating templates
autousers usage --range 30d           # quota + token spend rollup
autousers logout                      # revoke + clear local credentials
```

Every command supports `--json` for stable machine-readable output:

```bash
autousers eval list --json | jq '.[] | select(.status == "Running")'
```

Run any subcommand with `--help` for its specific flags.

---

## Configuration

| Variable             | Default                    | Description                  |
| -------------------- | -------------------------- | ---------------------------- |
| `AUTOUSERS_API_KEY`  | —                          | Bearer token (`ak_live_...`) |
| `AUTOUSERS_BASE_URL` | `https://app.autousers.ai` | Override the API host        |
| `NO_COLOR`           | —                          | `1` disables ANSI color      |

Global flags: `--json`, `--quiet`, `--no-color`, `--key`, `--base-url`.

Exit codes: `0` OK · `1` generic error · `2` auth · `3` not found · `4`
validation · `64` usage error.

---

## See also

- [autousers.ai/help/cli](https://autousers.ai/help/cli) — full CLI guide
- [`@autousers/mcp`](https://www.npmjs.com/package/@autousers/mcp) — Autousers
  inside Claude / Cursor / ChatGPT via the Model Context Protocol
- [Mint an API key](https://app.autousers.ai/settings/api-keys)
- [License](./LICENSE) — MIT
