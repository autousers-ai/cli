# Changelog

All notable changes to `@autousers/cli` will be documented here.
Format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).
This project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.1.0] — 2026-05-01

Initial scaffold; commands shipping in subsequent releases. Ships the
`autousers` bin with `--version` / `--help` wired up and placeholder
subcommands (`login`, `logout`, `whoami`, `eval`, `usage`, `version`) that
exit 64 ("command not yet implemented") so MCP hosts and shell users can
discover the surface ahead of feature rollout.
