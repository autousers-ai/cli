# @autousers/cli

Official command-line interface for [Autousers](https://autousers.ai) — run UX
evaluations, kick off autouser runs, and inspect calibration from your
terminal. Same `ak_live_*` API key as [`@autousers/mcp`](https://www.npmjs.com/package/@autousers/mcp).

[![npm version](https://img.shields.io/npm/v/@autousers/cli)](https://www.npmjs.com/package/@autousers/cli)
[![MIT licensed](https://img.shields.io/npm/l/@autousers/cli)](./LICENSE)

> **Status — 0.1.0 scaffold.** The bin and subcommand surface exist; individual
> commands ship in subsequent releases. Run `autousers --help` to see what's
> available today.

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

The CLI authenticates to `https://app.autousers.ai/api/v1/*` with a long-lived
bearer token. Mint one at
[app.autousers.ai/settings/api-keys](https://app.autousers.ai/settings/api-keys)
— keys are shown **once**, so paste it into a secrets manager or the CLI
config immediately.

Three ways to supply the key, in priority order:

1. **`--key ak_live_...`** — explicit per-invocation flag.
2. **`AUTOUSERS_API_KEY=ak_live_...`** — environment variable. Best for CI.
3. **`~/.autousers/config.json`** — written by `autousers login`. File mode
   `0600`.

To override the API host (e.g. for a self-hosted or local dev environment):

```bash
export AUTOUSERS_BASE_URL=https://app.autousers.ai
```

The default is `https://app.autousers.ai`.

---

## Quickstart

```bash
autousers --help        # discover available subcommands
autousers --version     # print CLI version
autousers login         # save your API key to ~/.autousers/config.json
autousers whoami        # confirm the active account
autousers eval list     # list your evaluations
autousers usage         # token + free-run usage rollup
```

Run any subcommand with `--help` for its specific flags.

---

## Configuration

| Variable             | Default                    | Description                  |
| -------------------- | -------------------------- | ---------------------------- |
| `AUTOUSERS_API_KEY`  | —                          | Bearer token (`ak_live_...`) |
| `AUTOUSERS_BASE_URL` | `https://app.autousers.ai` | Override the API host        |

---

## See also

- [autousers.ai/help/cli](https://autousers.ai/help/cli) — full CLI guide
- [`@autousers/mcp`](https://www.npmjs.com/package/@autousers/mcp) — Autousers
  inside Claude / Cursor / ChatGPT via the Model Context Protocol
- [Mint an API key](https://app.autousers.ai/settings/api-keys)
- [License](./LICENSE) — MIT
