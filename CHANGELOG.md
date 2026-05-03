# Changelog

All notable changes to `@autousers/cli` will be documented here.
Format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).
This project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [1.1.1] — 2026-05-03

### Fixed

- **Stable React 19 runtime dependency** (`cli/package.json`). The `react` runtime dep was pinned to the December 2024 RC build (`19.0.0-rc-de68d2f4-20241204`) — a holdover from the Wave 2 port from `uxrater`. Every `npm install -g @autousers/cli` printed three `ERESOLVE overriding peer dependency` warnings because `@jrichman/ink@^6.4.10`, the bare `ink` alias, and `zustand@^5` all peer-require stable `react>=19.0.0`. Bumped to `^19.0.0` (resolves to `19.2.5`); zero ERESOLVE warnings on a clean install. No CLI source uses RC-only React APIs, so this is purely a dependency-correctness fix — no behaviour change.

## [1.1.0] — 2026-05-02

### Added — Wave 10 (partial): plain-mode polish (completion + init + configure)

- **Project-level config** (`cli/src/config.ts`). New `ProjectConfig` type (subset of `CliConfig` — `baseUrl`, `activeTeamSlug`, `output`; auth fields intentionally absent so a checked-in `.autousers.json` can never leak a refresh token). New `findProjectConfigPath()` walks up from CWD looking for `.autousers.json` (same algorithm as `git`/`npm`/`prettier`); `readProjectConfig()` and `writeProjectConfig()` round-trip the file. The existing `getBaseUrl()` precedence becomes explicit > env > project > global > prod default; new `getActiveTeamSlug()` and `getDefaultOutput()` follow the same pattern. Auth resolution is unchanged — `.autousers.json` cannot supply `apiKey` / `accessToken`.
- **`autousers completion bash | zsh | fish`** (`cli/src/commands/completion.ts`). Static shell-completion script generator that walks the live commander tree (so it stays in sync with whatever subcommands are wired up). Bash uses `compgen` + `COMP_WORDS` with case-statement dispatch on the chosen top-level subcommand; zsh emits `#compdef autousers` and uses `_describe`; fish emits one `complete -c autousers` line per command/subcommand. Per-flag completion is intentionally out of scope. Install: `autousers completion zsh > ~/.autousers/_autousers && echo 'fpath=(~/.autousers $fpath); compinit' >> ~/.zshrc`.
- **`autousers init`** (`cli/src/commands/init.ts`). Drops a `.autousers.json` in the current directory (or `--global` writes to `~/.autousers/config.json`) seeded with `{ baseUrl, activeTeamSlug, output }`. Three input shapes: flag-driven (`--team --base-url --output --yes`), interactive prompts (TTY, no flags), or `--global` which read-merges into the existing global config without clobbering auth. Refuses to overwrite an existing project file without `--force`; refuses to run non-interactively without `--yes`. JSON envelope output (`{path, config}`) when global `--json` is set.
- **`autousers configure`** (`cli/src/commands/configure.ts`). Plain-mode (line-prompt, NOT TUI) wizard for setting global CLI defaults at `~/.autousers/config.json`. Touches only `baseUrl` / `activeTeamSlug` / `output`; auth fields are NEVER read or written by this command including under `--reset`. Three modes: flag-driven (`--base-url --team --output --yes`), bare interactive (TTY-only, prompts for each field showing current as `[default]`), or `--reset` (drops the three preference fields, auth untouched). Mutually-exclusive guard: `--reset` combined with any field flag exits 4. JSON output emits a preference-only envelope so secrets never leak into shared logs.

### Added — TUI slash-command palette (shipped between v1.0.0 and v1.1.0)

- **Slash-command palette** (`feat(cli): wire slash command palette in TUI`, `4c753ec`). Type `/` from anywhere in the TUI to surface a fuzzy-searchable command picker — the same affordance the web app exposes. Reduces the need to memorise screen-specific keybinds.

### Fixed (shipped between v1.0.0 and v1.1.0)

- **First-time login + TUI auth gate** (`2d50b35`). Hides the main menu when signed out and replaces it with a sign-in card (`07dd1f1`); resolves a regression where new users landed on a non-functional menu before the OAuth flow had run.
- **`@inkjs/ui` runtime resolution** (`07a95a2`). Aliases the bare `ink` specifier to `@jrichman/ink` so `@inkjs/ui` (which hard-imports vanilla `ink`) resolves at runtime against the fork the CLI is built against.
- **`/api/v1/auth/whoami` endpoint + accessible brand blue** (`b897c4c`). Adds the missing whoami endpoint the TUI's header banner depends on; bumps the brand blue's contrast ratio so the wordmark passes WCAG AA on dark terminals.
- **Full read+write OAuth scopes for TUI flows** (`3ee7bde`). The Wave 1 OAuth scope set was read-only; mutating screens (eval-creator, autorater-creator, etc.) need write scopes too.
- **Real-API-backed autouser/dimension lists** (`8df7083`). Removes hardcoded autouser/dimension fixtures from the eval-creator wizard; pulls from `/api/v1/autousers` and `/api/v1/dimensions` instead. Improves edit-form hydration on the autorater-creator (existing values populate when entering edit mode rather than starting blank).
- **`openUrl` guard under VITEST** (`10c0164`). Prevents the auto-`open in browser` keybind from spawning a real browser when running under vitest; the previous implementation occasionally launched Safari mid-test on macOS CI runners.
- **Settings BYOK section test timing** (`96e6d47`). Tightens timing in the Wave-9 settings test that flaked against the post-v1.0 expansion of the section list (Usage / Connected apps were added; the original tick budget was tuned to the smaller list).

### Changed (shipped between v1.0.0 and v1.1.0)

- **Docs** (`ef4279e`). The README + help text now distinguish TUI vs plain-CLI modes explicitly so users discover the bare-`autousers` TTY-launch behaviour.

### Tests

- **31 new vitest cases** (412 total, was 381):
  - `config.test.ts` (10) — project-config walk-up, read/write round-trip, malformed-JSON rethrow, and the precedence matrix for `getBaseUrl` / `getActiveTeamSlug` / `getDefaultOutput`.
  - `commands/completion.test.ts` (6) — bash / zsh / fish header markers, full top-level command enumeration, nested subcommand presence, and the unknown-shell exit-4 path.
  - `commands/init.test.ts` (8) — project-mode flag-driven write, `--output` enum validation (good + bad), refuse-overwrite without `--force`, `--force` overrides, non-TTY without sufficient flags exits 4, JSON envelope shape, and `--global` merge preserves `accessToken` / `refreshToken` / `apiKey`.
  - `commands/configure.test.ts` (7) — flag merge, partial flag merge, `--reset` preserves auth, mutually-exclusive `--reset + --team` exits 4, bad `--output` exits 4, non-TTY no-flags exits 4, JSON envelope contains zero auth tokens.

### Notes — Wave 10 items deferred

- `autousers exec` (batch YAML/JSON in, JSONL out) — deferred until a real user asks; powerful but no current demand.
- `autousers <unknown>` PATH-fallback plugin surface (kubectl/git pattern) — deferred for the same reason; ~2hr to add when needed.
- `autousers eval list --json --stream` long-polling — deferred; the existing `autousers eval watch <id>` SSE consumer covers in-flight runs.

## [1.0.0] — 2026-05-02

**v1.0 declares feature parity with `@autousers/mcp`'s tool surface.** Anyone
using the MCP server from Claude can now do the same things from a shell.

### Added — Wave 9: templates (AI-assisted) + dimensions + settings + teams + API keys

- **Templates hub screen.** New `cli/src/tui/components/screens/templates-hub.tsx` lists every visible template (built-in + custom). Source / scale / last-updated columns; filter cycle on `/` (all → custom → built-in). Menu item 4 ("Manage templates") now routes here directly rather than through the Wave-3 placeholder. Keybinds: `Enter` edit (custom only) · `n` new (AI) · `f` new (form) · `d` duplicate · `D` delete · `o` browser · `Esc` menu. Mirrors the autoraters-hub shape (Wave 8) so users get one mental model for "manage a resource".
- **AI-assisted template creator.** New `cli/src/tui/components/screens/template-creator.tsx` mirrors the autorater-creator from Wave 8. Two modes (`?` toggles): **describe** (default) where the user types a free-text description like "trust signals on a SaaS landing page" and the CLI streams the model's reasoning into a "Thinking…" pane via `POST /api/v1/templates/draft-from-prompt` (server endpoint landed in `0b27ba3`); once the `proposal` SSE event fires the review pane shows the structured fields with `a` accept · `e` edit form · `t` try again · `Esc` cancel. Reuses Wave 8's `useAiStream` hook — the hook is now generic over the proposal shape via a `validateProposal` option, with `isTemplateDraftProposal` exported alongside `isAutouserDraft`. Edit mode loads via GET, populates the form, saves via PATCH.
- **Settings screen.** New `cli/src/tui/components/screens/settings.tsx` — four sections navigable by ↑↓:
  - **Profile** (read-only display of email / team / plan / free-runs left, sourced from the existing `authUser` slice).
  - **BYOK · Gemini API key** — `t` test the saved key, `s` set / replace, `p` probe a typed key without saving, `u` unset. **NO `--provider` switch** per the Wave 9 audit (the `User.geminiApiKey` schema is hard-coded; multi-provider is a Wave 11+ refactor).
  - **API keys** — `n` mint a new key (prompts for name; surfaces the plain key ONCE with a "won't be shown again" warning banner), `j/k` navigate, `R` revoke.
  - **Switch active team** — Enter delegates to the teams-section screen.
- **Teams section screen.** New `cli/src/tui/components/screens/teams-section.tsx` lists every team the caller belongs to. Enter sets the highlighted row as the active team (persisted to `~/.autousers/config.json`'s new `activeTeamSlug` field; subsequent commands implicitly scope). `l` leaves a team via `POST /api/v1/teams/:id/leave`. `t` opens an inline input prompt for transfer-admin (target user id), then POSTs `.../transfer-admin`.
- **Plain-mode subcommand groups** (mirrors the Wave 4 / Wave 8 splits — each command in its own file with a `register…(parent)` factory):
  - **Templates** (`cli/src/commands/template/`):
    - `autousers template list` — moved from `cli/src/commands/template.ts` into the folder; output unchanged so existing scripts keep working.
    - `autousers template create [--name --description --scale | --describe "..." [--confirm]]` — flag-driven or AI-assisted. The `--describe` path streams the proposal from the server endpoint; without `--confirm` it prints a preview and exits 0, with `--confirm` it persists. Lazy-imports the streaming code so plain-mode startup stays fast for non-AI invocations.
    - `autousers template update <id> [--name --description]` — PATCH the named fields.
    - `autousers template delete <id> [--yes]` — DELETE with confirm prompt; non-TTY requires `--yes`.
    - `autousers template duplicate <id> [--team <id>]` — POST .../duplicate.
  - **Dimensions** (`cli/src/commands/dimension/`): `list`, `create`, `update`, `delete`, `duplicate`, `version <id>` (lists versions), `version-revert <id> <versionId>` (reverts). Templates and dimensions alias the same server resource but are exposed as separate command groups so scripted callers can pick the noun matching their mental model.
  - **Teams** (`cli/src/commands/team/`): `list`, `use <slug>` (writes `activeTeamSlug` to `~/.autousers/config.json`), `leave <id>`.
  - **Settings** (`cli/src/commands/settings/`):
    - `autousers settings byok set --key <api-key>` — Gemini-only; no `--provider` flag.
    - `autousers settings byok test` — re-test the saved key against AI Studio.
    - `autousers settings byok probe --key <api-key>` — validate without saving.
    - `autousers settings byok unset` — clear the saved key.
  - **API keys** (`cli/src/commands/key/`):
    - `autousers key list` — per-team keys with name / prefix / scopes / status / last-used.
    - `autousers key create --name <n> [--scope eval:read,...] [--expires-at <iso>]` — mints and **prints the plain key ONCE** with a red banner stating it will never be shown again.
    - `autousers key revoke <id>` — DELETE the key.

### Changed

- `Screen` union in `cli/src/tui/state.ts` adds `templates-hub`, `template-creator`, `settings`, `teams-section`. `PlaceholderTarget` collapses to the inert sentinel `"never"` (every menu destination now has a real screen). Store gains two Wave-9 fields (`editingTemplateId`, `activeTeamSlug`) plus matching setters; `activeTeamSlug` is also persisted to `~/.autousers/config.json` via the new `CliConfig.activeTeamSlug` field so it survives across invocations.
- `useAiStream` hook is now generic over the proposal shape: `useAiStream<TProposal>(opts)` accepts a `validateProposal` type guard, defaulting to the autouser-draft validator. New `TemplateDraftProposal` type + `isTemplateDraftProposal` validator exported. The autorater-creator continues to use the default; the template-creator passes the template-draft pair.
- `cli/src/tui/components/interactive/mode-selector.tsx` routes menu item 4 to `screen: "templates-hub"` and item 5 to `screen: "settings"` directly.
- `cli/src/tui/app.tsx` extends the parent's `useInput` exclusion list so the new screens own their own keybinds, mounts `<TemplatesHub>` / `<TemplateCreator>` / `<Settings>` / `<TeamsSection>` for the new screens, drops the `template-hub` and `settings` placeholder labels (the placeholder body is now intentionally inert post-Wave-9).
- `cli/src/commands/template.ts` is now a backwards-compat re-export forwarding to `cli/src/commands/template/index.ts`.
- `cli/src/index.ts` registers four new top-level subcommand groups (dimension / team / settings / key) alongside the existing eval / autouser / template trees.
- `cli/src/config.ts` adds `CliConfig.activeTeamSlug` — the persisted active team slug.

### Tests

- 42 new vitest cases (~373 total): `templates-hub.test.tsx` (11 — `applyTemplateFilters` + render + key-driven routing + delete/duplicate flows + filter cycle), `template-creator.test.tsx` (6 — describe pane, mode toggle, Enter sends + proposal, accept POSTs and routes, Esc, edit-mode prefetch), `settings.test.tsx` (5 — load + section nav + BYOK test + API-key mint with one-time reveal + Teams routing), `teams-section.test.tsx` (4 — render + Enter persists slug + leave + Esc), plain-mode `template/create.test.ts` (2), `template/update.test.ts` (2), `template/duplicate.test.ts` (1), `team/use.test.ts` (1), `team/list.test.ts` (1), `key/create.test.ts` (2), `key/list.test.ts` (1), `settings/byok/byok.test.ts` (5 across set / test / probe / unset), `dimension/dimension.test.ts` (3 across list / version / version-revert), state-store updates (4), mode-selector route updates (1). Build clean (`cli/` `npm run build`); the existing 289 Wave-1-8 tests continue passing. (One pre-existing dashboard-test suite has an unrelated `ink` package-resolution issue that landed before Wave 9; not introduced by this wave.)

## [0.9.0] — 2026-05-02

### Added — Wave 8: autouser CRUD + AI-assisted creator + calibration

- **Autoraters hub screen.** New `cli/src/tui/components/screens/autoraters-hub.tsx` ports uxrater's autorater hub. Lists every visible autouser (built-in + custom) with source / calibration-status / last-updated columns; filter cycle on `/` (all → custom → built-in). Menu item 3 ("Manage autousers") now routes here directly rather than through the Wave-3 placeholder. Keybinds: `Enter` edit (custom only) · `n` new (AI-assisted) · `f` new (form fallback) · `d` duplicate · `D` delete · `c` calibrate · `o` browser · `Esc` menu.
- **AI-assisted autorater creator.** New `cli/src/tui/components/screens/autorater-creator.tsx` is the marquee Wave 8 surface. Two modes (toggle with `?`): **describe** (default) where the user types a free-text persona description, presses Enter, and the CLI streams the model's reasoning into a "Thinking…" pane via `POST /api/v1/autousers/draft-from-prompt`; once the server emits the `proposal` SSE event the review pane shows the structured fields with `a` accept · `e` edit form · `t` try again · `Esc` cancel. The **form** mode is a manual-entry fallback. Edit mode (when the hub seeds `editingAutouserId`) loads the existing autouser via GET, populates the form, saves via PATCH instead of POST.
- **Ink-friendly AI streaming hook.** New `cli/src/tui/hooks/use-ai-stream.ts` is a custom fetch + ReadableStream + manual SSE parser. Deliberately not `@ai-sdk/react`'s `useChat` — Ink renders to a terminal not the DOM, and the React-specific hooks in that package (`AbortSignal.timeout`, `EventSource`-backed streaming inside DOM-only effects) don't fit. Same pattern as Wave 5's `runner.ts`. Reusable for Wave 9's template creator (configurable `endpoint` prop).
- **Autorater calibration wizard.** New `cli/src/tui/components/screens/autorater-calibration.tsx` — three-step flow (status fetch → pick action → result). Actions: start a calibration run, freeze the active rubric, run a model-driven optimization pass. Surfaces κ (kappa), agreement, sample size from `GET /api/v1/autousers/:id/calibration`. Each action POSTs to its respective endpoint and renders the response.
- **Plain-mode subcommands** — `cli/src/commands/autouser.ts` was split into `cli/src/commands/autouser/` (mirrors Wave 4's `eval/` layout):
  - `autousers autouser create [--name --description --persona --criteria | --from-template <id> | --describe "..." [--confirm]]` — flag-driven, clone-from-template, or AI-assisted. The `--describe` path streams the proposal from the server endpoint; without `--confirm` it prints a preview and exits 0, with `--confirm` it persists. Lazy-imports the streaming code so plain-mode startup stays fast for non-AI invocations.
  - `autousers autouser update <id> [--name --description --persona --criteria]` — PATCH the named fields.
  - `autousers autouser delete <id> [--yes]` — DELETE with confirm prompt; non-TTY requires `--yes`.
  - `autousers autouser duplicate <id> [--team <id>]` — POST .../duplicate.
  - `autousers autouser calibrate <id> [--gold-set <id>]` — POST .../calibration/start.
  - `autousers autouser freeze <id> [--rubric <id>]` — POST .../calibration/freeze.
  - `autousers autouser optimize <id> [--apply]` — POST .../calibration/optimize. Surfaces summary + rationale + bias assessment + estimated improvement.
  - `autousers autouser rubrics <id>` — GET .../rubrics, table-rendered.
  - `autousers autouser rubric add <autouserId> --criteria <text>` — POST .../rubrics.
  - `autousers autouser rubric update <autouserId> <rubricId> [--criteria --name --status]` — PATCH .../rubrics/:rubricId.
- **`getResolvedBearer` helper** in `cli/src/client.ts` — extracted from the private `resolveBearer` so SSE-streaming consumers (the Wave 8 creator + the plain-mode `--describe` flow) can attach `Authorization` headers to a raw `fetch` without going through the client's `request<T>()` (which buffers the response into JSON).
- **Autorater picker promotion.** `cli/src/tui/components/interactive/autorater-picker.tsx`'s "+ New autouser" affordance is no longer disabled — selecting it routes to the new autorater-creator screen via the global store.

### Changed

- `Screen` union in `cli/src/tui/state.ts` adds `autoraters-hub`, `autorater-creator`, `autorater-calibration`. `PlaceholderTarget` drops `autouser-hub` (real screen now). Store gains two Wave-8 fields (`editingAutouserId`, `calibratingAutouserId`) plus matching setters.
- `cli/src/tui/components/interactive/mode-selector.tsx` routes menu item 3 to `screen: "autoraters-hub"` directly.
- `cli/src/tui/app.tsx` extends the parent's `useInput` exclusion list so the new screens own their own keybinds, mounts `<AutoratersHub>` / `<AutoraterCreator>` / `<AutoraterCalibration>` for the new screens, drops `autouser-hub` from the placeholder labels map.
- `cli/src/commands/autouser.ts` removed; `cli/src/commands/autouser/index.ts` is the new aggregator. The `autousers autouser` description string enumerates the now-ten subcommands.
- `cli/src/index.ts` updated to import the aggregator from `./commands/autouser/index.js`.

### Tests

- 53 new vitest cases (289 total, was 236): `use-ai-stream.test.tsx` (7 — chunk accumulation, proposal surfacing, error events, HTTP errors, bearer header, reset, configurable endpoint), `autoraters-hub.test.tsx` (12 — `applyHubFilters` + render + key-driven routing + delete/duplicate flows + filter cycle), `autorater-creator.test.tsx` (6 — describe pane, mode toggle, Enter sends + proposal, accept POSTs and routes, Esc, edit-mode prefetch), `autorater-calibration.test.tsx` (6 — status load, start/freeze/optimize endpoints, Enter on highlighted action, Esc), plus plain-mode `create.test.ts` (3), `update.test.ts` (2), `delete.test.ts` (2), `duplicate.test.ts` (2), `calibrate.test.ts` (2), `freeze.test.ts` (1), `optimize.test.ts` (2), `rubrics.test.ts` (5), state-store updates (3), mode-selector route update (1), autorater-picker promotion (1). Build clean (`cli/` `npm run build`); existing 236 tests continue passing.

## [0.8.0] — 2026-05-02

### Added — Wave 7: eval history browser + sharing

- **Eval history screen.** New `cli/src/tui/components/screens/eval-history.tsx` ports uxrater's history list and extends it with a focusable filter bar (status / type / date range / owner), a sort cycle (`c` cycles created desc → name → cost desc), and per-row action keybinds. Menu item 2 ("Browse evaluations") now routes here directly rather than through the Wave-3 placeholder. Esc returns to the menu.
- **Action keybinds**: `Enter` opens the results view, `o` prints the dashboard URL, `s` opens the share modal, `i` opens the invite modal, `t` opens the transfer modal, `d` opens the delete-confirm modal, `/` focuses the search field, `Tab` toggles between list and filters focus.
- **Four small modals** built on the Wave-3 `Modal` primitive: `share-modal.tsx`, `invite-modal.tsx`, `transfer-modal.tsx`, `delete-confirm-modal.tsx`. Each owns its own form state + POST + error handling; resolutions return through an `onClose({ kind, message })` callback the host (history list) maps to a toast banner. The transfer modal uses the warning border colour; the delete-confirm modal uses the error colour.
- **Eval-results-by-id screen.** `cli/src/tui/components/screens/eval-results-view.tsx` is a thin wrapper that mirrors `selectedEvalId → evaluationId` and renders Wave 6's `<ResultsView>` with an `onBack` callback returning to the history list. No duplication of the tabbed-results logic — the wrapper is ~30 LOC.
- **`<ResultsView onBack>` prop.** Wave 6's results screen now accepts an optional callback that overrides the default Esc → main-menu behaviour. Wave 7 uses it to route Esc → history list when the results were entered from the history browser; Wave 6's auto-transition flow continues to use the default.
- **Plain-mode subcommands**:
  - `autousers eval share <id> --email <addr> [--role viewer|editor|owner]` — POSTs `/api/v1/evaluations/:id/shares`. Default role `viewer`. Validates the role enum locally so a bad value gets a code-4 exit before the network call.
  - `autousers eval invite <id> --email <addr>` — POSTs `/api/v1/evaluations/:id/invites`. Email must contain `@` (front-validated).
  - `autousers eval transfer <id> --to <team-slug-or-id>` — POSTs `/api/v1/evaluations/:id/transfer`. Surfaces a hint reminding the caller that the previous owner is now a regular member.
  - `eval delete` already existed from Wave 4 — unchanged.

### Changed

- `Screen` union in `cli/src/tui/state.ts` adds `eval-history` and `eval-results-by-id`. `PlaceholderTarget` drops `eval-history` (real screen now). Store gains four Wave-7 fields (`selectedEvalId`, `historyQuery`, `historyFilters`, `historySort`) plus matching setters; the filter bar mutates through these so state persists across re-mounts and tests can inspect it directly.
- `cli/src/tui/components/interactive/mode-selector.tsx` routes menu item 2 to `screen: "eval-history"` directly.
- `cli/src/tui/app.tsx` extends the parent's `useInput` exclusion list so the new screens own their own keybinds, mounts `<EvalHistory>` for `eval-history` and `<EvalResultsView>` for `eval-results-by-id`, and drops `eval-history` from the placeholder labels map.
- `cli/src/commands/eval/index.ts` registers the three new subcommands; the description string enumerates the now-fifteen subcommands.

### Tests

- 37 new vitest cases (236 total, was 199): `eval-history.test.tsx` (10 — `applyHistoryFilters` filter axes + sorts, list rendering, navigation, action keybinds), `share-modal.test.tsx` (4 — render, POST contract, Esc cancel, role cycling), `invite-modal.test.tsx` (3 — render, POST, validation), `transfer-modal.test.tsx` (3 — render, POST, empty target rejection), `delete-confirm-modal.test.tsx` (4 — render, y triggers DELETE, n cancels, Esc cancels), plain-mode `share.test.ts` (4), `invite.test.ts` (3), `transfer.test.ts` (2), plus state-store updates (3) and mode-selector route updates (2). Build clean (`npm run build` in `cli/`); existing 199 tests continue passing.

## [0.7.0] — 2026-05-02

### Added — Wave 6: tabbed results view

- **Results screen.** New `cli/src/tui/components/results/` ports uxrater's tabbed results layout: `index.tsx`, `tab-bar.tsx`, three tab panels (`tab-overall.tsx`, `tab-comparisons.tsx`, `tab-stats.tsx`), and a fourth Cost tab using `cost-breakdown.tsx`. Visualizations: `score-bar.tsx` (SSE 1-5), `preference-bar.tsx` (SxS -3..+3), `head-to-head-bar.tsx` (aggregate A/B/Tied stack), `distribution-chart.tsx` (rating histogram), `metric-cards.tsx` (key/value cards). Mounted whenever `screen === "results"`.
- **`useResultsData` hook** (`use-results-data.ts`). Fetches `GET /api/v1/evaluations/:id/results`, adapts the rich server envelope (aggregate stats + comparison stats + agreement + dimension stats) into a `ResultsData` view-model that mirrors uxrater's hook shape. Module-level cache keyed by eval id keeps tab switches free; `invalidateResultsCache(id?)` refreshes from the server. The pure `adaptServerResults()` function is exported for unit testing.
- **Markdown renderer** (`cli/src/tui/components/markdown.tsx`). Inline ports of uxrater's `MarkdownText` — bold, bullet lists, numbered lists, paragraph spacing — kept dependency-free (no `react-markdown`).
- **Auto-transition from dashboard.** Once Wave 5's runner emits `run:complete`, the dashboard now calls `setScreen("results")` so the TUI flips straight into the results view without the user navigating manually. The eval id is preserved in the store so the results hook's fetch lands on the right resource.
- **Tab keybinds.** `1-4` direct-jump (Comparisons gated on SxS evals; SSE evals show `1·3·4`), `Tab`/`Shift+Tab` cycle, `↑↓` scrolls comparison rows on tab 2, `o` opens the dashboard's web URL in the browser (best-effort — falls back to printing the URL), `e` opens an export-format selector modal pointing the user at the plain-mode `autousers eval export` shell command. `Esc`/`b` returns to the menu.
- **Plain-mode subcommands**:
  - `autousers eval results <id> [--json]` — human-readable summary by default, full server envelope on `--json`.
  - `autousers eval ratings <id> [--json]` — one row per rating (rater id · comparison · avg score) or raw envelope on `--json`.
  - `autousers eval export <id> [--format json|csv|md]` — streams the server's export body to stdout so `autousers eval export <id> --format md > report.md` Just Works. Uses raw `fetch` rather than `AutousersClient.get` because CSV/Markdown bodies aren't JSON.

### Changed

- `Screen` union in `cli/src/tui/state.ts` adds `results`. Store has no new fields; the existing `evaluationId` + `cost` + `progress` carry the data the results view needs.
- `cli/src/commands/eval/index.ts` registers three new subcommands (`results`, `ratings`, `export`). Description updated to enumerate the now-twelve subcommands.
- `cli/src/tui/components/dashboard/index.tsx` adds one line to the `run:complete` handler that flips the screen to `results`. The SSE stream is aborted in the unmount cleanup as before.
- `cli/src/tui/app.tsx` extends the parent's `useInput` `isActive` exclusion list so the results screen owns its own keybinds (q-to-quit still wired via the in-screen `useInput`).
- **Server.** `app/api/v1/evaluations/[id]/export/route.ts` adds `--format md` support — the schema enum now includes `"md"` and the route emits a human-readable per-rating Markdown summary suitable for pasting into PRs / Notion.

### Tests

- 21 new vitest cases (199 total, was 178): `results.test.tsx` (5 — Overall tab SxS / SSE-without-Comparisons / tab-2 switch / tab-3 stats / export modal), `use-results-data.test.tsx` (6 — adapter SxS + SSE + null-agreement, hook fetch + cache + error), plain-mode `results.test.ts` (3), `ratings.test.ts` (3), `export.test.ts` (4 — CSV / Markdown / default JSON / non-2xx error). Build clean (`npm run build` in `cli/`); existing 178 tests continue passing.

## [0.6.0] — 2026-05-02

### Added — Wave 5: live dashboard via SSE

- **Live dashboard.** After eval-creator confirms (or on `autousers eval run` with TUI), the TUI transitions to a live-run dashboard at `cli/src/tui/components/dashboard/`. Header shows `N / M complete · K errors · $X.XX`; session list groups rows by phase (Active / Queued / Completed / Errors) with a per-row badge (`[NAV]` / `[JUDGE]` / `[DONE]` / `[ERR]` / `[WAIT]`); cost ticker on the right shows aggregate input/output tokens and total spend; collapsible error panel surfaces failures. `s` triggers a stop confirm modal that POSTs `/stop-autousers`; `↑↓` selects a session, `Enter` drills into it. Drill-in (`live-session-view.tsx`) shows phase + step + comparison count + tokens + the worker's latest `currentNarration`; transcripts aren't rendered because the server doesn't stream them.
- **SSE adapter** (`cli/src/tui/sse-adapter.ts`). Maps the four server-side event names (`snapshot`, `run_update`, `run_complete`, `done`) onto the 8-variant `TUIEvent` union ported from uxrater. Stateful — remembers which sessions have transitioned past `pending` so `session:start` fires exactly once per run, and dedupes terminal-status updates so a postgres_changes burst doesn't double-count.
- **SSE runner** (`cli/src/tui/runner.ts`). Replaces uxrater's ~500-line local-runner orchestration with a ~200-line consumer: opens the SSE stream via `fetch()` + `ReadableStream`, parses `event:` / `data:` framing, dispatches translated TUIEvents to the bus. Aborts cleanly on caller request.
- **Plain-mode subcommands**: `autousers eval run <id> [--dryRun] [--autousers <ids>]`, `autousers eval status <id>`, `autousers eval watch <id>` (JSONL on stdout, designed for `jq`), `autousers eval stop <id> [--yes]`. `watch` reuses the same runner + adapter as the dashboard so wire-shape mapping stays single-source.

### Changed

- `Screen` union in `cli/src/tui/state.ts` adds `dashboard` and `live-session`. Store gains `evaluationId`, `sessions: Map<id, SessionState>`, `progress: { completed, total, errors }`, `cost: { inputTokens, outputTokens, totalCost }`, `runStartedAt`, `drillSessionId`, `runComplete`. Setters land for each plus a `resetDashboard()` that wipes Wave-5 fields without touching auth/screen state.
- `TUIEvent` union (`cli/src/tui/events.ts`) replaces the Wave-2 `noop` placeholder with the real 8-variant surface (session:start / session:turn / session:nav-done / session:judging / session:result / session:error / run:progress / run:complete). `session:turn` and `session:nav-done` aren't synthesized by the SSE adapter (server doesn't stream per-turn detail) but stay in the union for plain-mode JSONL forward-compat and a future local runner.
- Eval-creator (`cli/src/tui/components/screens/eval-creator.tsx`) now sets `evaluationId` and switches the screen to `dashboard` when the user confirms a Live create, replacing the Wave-4 placeholder "watch progress with: autousers eval get …" message.
- `cli/src/commands/eval/index.ts` registers four new subcommands (`run`, `status`, `watch`, `stop`).
- `vitest.config.ts` inlines `@inkjs/ui` so its compiled ESM picks up the `ink` → `@jrichman/ink` alias (the dashboard's session-row uses `<Spinner/>` from inkjs/ui, which hard-imports vanilla `ink`).

### Tests

- 41 new vitest cases (178 total): `sse-adapter.test.ts` (12) + `runner.test.ts` (6) + `state.test.ts` Wave-5 cases (5) + dashboard component test (5) + plain-mode `eval run` (4) + `eval status` (3) + `eval watch` (1) + `eval stop` (3). Build clean (`npm run build` in `cli/`); existing 137 tests continue passing.

## [0.5.0] — 2026-05-02

### Added — Wave 4: eval creation wizard with dryRun preview

- **Eval-creation wizard.** The TUI's main-menu "Create new evaluation" item now routes to a real Ink-based wizard rather than the wave-3 placeholder. Seven steps: type (SSE/SxS) → URLs → autorater → dimensions → run config → review (server-side cost preview) → confirm. Each step owns its own keybinds; Esc inside any step rolls back to the previous step (or the menu from step 1). Lives at `cli/src/tui/components/screens/eval-creator.tsx`.
- **Generic wizard chrome.** `cli/src/tui/components/interactive/wizard.tsx` ports uxrater's wizard layout primitive — sidebar with `[x]/[>]/[ ]` step markers and per-step preview lines on wide terminals, breadcrumb collapse on narrow ones. Pure layout, no state — future waves (Wave 8 autouser creator, Wave 9 template creator) reuse the same chrome by passing a different `steps` array.
- **Autorater picker.** `cli/src/tui/components/interactive/autorater-picker.tsx` ports uxrater's picker, adapted to autousers' API: built-in personas (Casual Browser, Power User, First-Time Visitor, Conversion Skeptic) defined locally, custom autousers fetched from `GET /api/v1/autousers`. The "+ New autouser" affordance is rendered but disabled with a "(Wave 8)" label — Wave 8's conversational creator owns that flow.
- **Server-side dryRun preview.** The review step calls `POST /api/v1/evaluations` with `dryRun: true` (server support landed in commit `ff2385f`) and renders the cost forecast inline: "Would run: N ratings · Estimated cost: $X.XX (basis: ...)". On confirm the same payload is re-sent with `dryRun: false`. We never persist client-side cost guesses; the server is the source of truth.
- **Plain-mode `eval create`** (`autousers eval create [flags]`). Three input shapes:
  1. Flag-driven scripted (`--type sse --url … --autorater … --count 3 [--dryRun] [--confirm]`)
  2. JSON-on-stdin (`cat eval.json | autousers eval create --json`) — full payload pass-through to the API
  3. Interactive wizard (no flags, TTY) — mounts the same Ink wizard the bare-`autousers` TUI uses
- **Plain-mode `eval update <id>`** — `PATCH /api/v1/evaluations/:id` with `--name / --description / --status / --share-access`, plus `--json` for arbitrary patches piped from stdin.
- **Plain-mode `eval delete <id>`** — `DELETE /api/v1/evaluations/:id` with an interactive `[y/N]` confirm prompt; `--yes` bypasses the prompt and is required in non-interactive shells (CI / pipes).

### Changed

- `cli/src/commands/eval.ts` was a single file; Wave 4 split it into `cli/src/commands/eval/{list,get,create,update,delete}.ts` with an `index.ts` aggregator. `cli/src/commands/eval.ts` remains as a backwards-compat re-export so existing import paths in `src/index.ts` keep working.
- `Screen` type in `cli/src/tui/state.ts` adds `eval-creator`. The mode-selector's "Create new evaluation" item now routes to `screen: "eval-creator"` directly rather than through `placeholder` + `placeholderTarget: "eval-creator"`. The `placeholderTarget` enum drops its `eval-creator` entry; the remaining four targets (eval-history, autouser-hub, template-hub, settings) continue to land on the wave-3 placeholder body until their respective waves ship.
- Store gains a `toast` field for one-shot success / error banners surfaced after mutations. The eval-creator's confirm step uses it to surface "Evaluation queued — &lt;name&gt;"; auto-clears after 5s.

### Tests

- 36 new vitest cases (137 total): wizard chrome (6) + autorater-picker pagination/select/back (7) + eval-creator screen flow + payload contract (8) + plain-mode eval create flag/JSON/validation (8) + eval update (2) + eval delete (3) + state store (2 added).
- Build clean (`npm run build` in `cli/`); plain mode unchanged for existing commands (`autousers --help`, `autousers eval list --json` etc.).

## [0.4.0] — 2026-05-01

### Added — Wave 3: main menu + TUI auth

- **Main menu (mode selector).** The TUI now boots into a navigable six-item menu rather than the Wave 2 placeholder body. Items: 1. Create new evaluation, 2. Browse evaluations, 3. Manage autousers, 4. Manage templates, 5. Settings, 6. Logout. Items 1-5 route to a generic `placeholder` screen that wave 4-9 work replaces with real screens; item 6 (Logout) ships fully here. Ported from uxrater's `cli/components/interactive/mode-selector.tsx`, adapted for autousers' destination set + brand theme.
- **Modal primitive.** `cli/src/tui/components/interactive/modal.tsx` — generic bordered box used by Wave 3 (login status banners) and reused by later waves (share / invite / transfer dialogs in Wave 7, confirmation dialogs throughout). Ported from uxrater's `modal.tsx` with the brand-blue default border colour.
- **TUI-side auth flow** (`cli/src/tui/auth-flow.ts`). Wraps the existing `cli/src/oauth.ts` browser flow but shaped for the TUI: no `process.exit()`, no stdout writes, and pushes the resolved identity (email + team + plan + quota) into the zustand store on success so the header banner refreshes without a screen change. `tuiLogout()` mirrors plain-mode logout (`/oauth/revoke` POST + local config wipe) and clears the store. `fetchAuthUser()` is a `null`-safe identity probe used on TUI mount so a persisted bearer surfaces in the header without an explicit login.
- **Keybinds** — global: `q` quit, `ctrl-c` quit, `l` toggle login/logout. Menu-local: `↑↓` navigate, `Enter` select highlighted, `1-6` quick-select, `?` toggle help legend.
- **Header / store wiring.** `App` now mounts a `useEffect` that calls `fetchAuthUser()` once on mount, populating the store from any persisted bearer. The header reads `authUser` and renders `Signed in as you@autousers.ai · TeamName · /logout` (Wave 2 already had this code path; Wave 3 wires it to real data).
- **Placeholder screen.** A single body component renders for menu items 1-5 with a "ships in Wave N" hint and Esc-to-back keybind. Wave 4-9 replace `placeholder` rendering as their respective screens land — the menu doesn't need updating.

### Changed

- `Screen` type extended to include `loading-auth` (reserved for future flows that surface auth as a full-screen state) and `placeholder` (catch-all for wave-4-9 destinations).
- Default `screen` flipped from `welcome` to `menu` so the TUI lands on the mode selector immediately. The `welcome` screen name is reserved for a future first-run onboarding flow (likely a Wave 9 BYOK / API-keys walkthrough).
- Store gains a `placeholderTarget` field so the menu's six items can route through a single `placeholder` screen with a discriminator that wave 4-9 work consumes when replacing each placeholder with its real screen.

### Tests

- 24 new vitest cases (101 total): mode-selector keybind/render coverage (13) + auth-flow behaviour coverage (10) + state-store updates (1).
- Build clean (`npm run build` in `cli/`); plain mode unchanged (`autousers --help`, `autousers eval list --json` etc.).

## [0.3.0] — 2026-05-01

### Added — TUI foundation

- **Interactive TUI mode.** `autousers` (no args, in a TTY) now launches an Ink-based interactive UI. Plain commands (`autousers eval list`, etc.) are unchanged — mode is auto-detected from argv and TTY status.
- **Branded start screen** — ANSI Shadow figlet rendering of the "AUTOUSERS" wordmark in brand blue (`#0050FF`), followed by version, signed-in user/team/plan, working directory. Same font uxrater used; modern CLIs (`gh`, `vercel`, `stripe`) use plain wordmark text rather than pixelated figure marks for the same reason: terminal cells are too coarse to render anti-aliased curved logos cleanly, so the wordmark IS the brand identity in CLI context.
- **Foundation modules**: `cli/src/tui/{state,events,tty,theme,app}.ts` + `cli/src/tui/components/{header,footer,inline-text-input}.tsx`. Wave 3 ships the main menu on top of this foundation; Waves 4–9 build the eval wizard, live dashboard, results view, history browser, autouser/template management with AI-assisted creation, and teams/settings screens (see `docs/CLI_ROADMAP.md`).
- **Build-time logo asset generator** — `scripts/generate-logo-ansi.mjs` (devDep `terminal-image`) pre-renders `public/logo/autousers_logo@2x.png` to `LOGO_ITERM2` (OSC 1337 inline-image escape) + `LOGO_BLOCKS` (truecolor half-block ANSI). Currently unused (the wordmark banner won out) but kept available for future wave work; `npm run regen:logo` regenerates if the source PNG changes.
- Dependencies: `@jrichman/ink@^6.4.10`, `@inkjs/ui@^2.0.0`, `react@19.0.0-rc-de68d2f4-20241204`, `zustand@^5.0.8`. Dev: `ink-testing-library@^4`, `terminal-image@^4` (build-only, never shipped).

### Changed

- Mode detection: `autousers` with no subcommand + TTY → TUI; any subcommand or `--no-tui` or non-TTY/CI → plain mode (unchanged behaviour).
- `cli/tsconfig.json` adds `"jsx": "react-jsx"` and `"types": ["node"]` for the TUI compile path.

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
