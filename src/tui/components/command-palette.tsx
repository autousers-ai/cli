/**
 * Slash-command palette for the autousers TUI.
 *
 * Wave 11 — fixes a long-standing UX broken-promise: the footer reads
 * "Type / for commands" and the header surfaces clickable hints like
 * `/logout` and `/upgrade`, but the keybind wasn't actually wired. Pressing
 * `/` now opens this small bordered modal at the bottom of the screen,
 * captures input, and dispatches one of the registered commands.
 *
 * The palette is intentionally minimal: a single text field, an
 * autocomplete-on-Tab grey suffix when the typed prefix uniquely matches a
 * registered command, and a one-line description of the matched command
 * underneath. Enter dispatches; Esc closes; Tab autocompletes from the
 * registered list.
 *
 * Why a full component rather than inlining into App?
 * --------------------------------------------------
 * Two reasons:
 *
 *   1. `useInput` is per-component in Ink — a child component's hook will
 *      "win" over a sibling's most-recent registration. Putting the
 *      palette's input handling here means it owns input the moment it
 *      mounts (when `commandPaletteOpen` flips true) and releases it the
 *      moment it unmounts. That's exactly the contract the brief asked
 *      for: "Don't take input focus away from the active screen unless
 *      the palette is genuinely open".
 *
 *   2. Commands route to side-effecting flows (auth, browser-open, screen
 *      navigation) that pull in the auth-flow / oauth modules. Keeping
 *      them off App's dependency graph lets `app.tsx` stay focused on
 *      routing.
 *
 * Registered commands
 * -------------------
 *  - `/login`    → kick off the OAuth browser flow
 *  - `/logout`   → revoke server token + clear local config
 *  - `/upgrade`  → open the billing URL in the system browser
 *  - `/help`     → toast a one-line legend (the menu's `?` keybind already
 *                   owns the per-screen help modal; we don't duplicate it)
 *  - `/team`     → route to teams-section (auth-gated)
 *  - `/settings` → route to settings (auth-gated)
 *  - `/version`  → toast the CLI version string
 *  - `/quit`     → exit the TUI cleanly via `useApp().exit()`
 *
 * The header's existing `/logout` and `/upgrade` text labels now match a
 * real dispatch target — typing the matching command runs the same code
 * the click-via-label promise implied.
 */
import { useState } from "react";
import { Box, Text, useApp, useInput } from "@jrichman/ink";

import { useTUIStore } from "../state.js";
import { Theme } from "../theme.js";
import { CLI_VERSION } from "../../client.js";
import { startTuiLogin, tuiLogout } from "../auth-flow.js";
import { openUrl } from "../../oauth.js";

/** Fallback target when a command's URL isn't otherwise wired (yet). */
const HELP_FALLBACK_URL = "https://autousers.ai/help";
/** Billing target — same anchor the web app uses for the upgrade CTA. */
const BILLING_URL = "https://autousers.ai/help#billing";

/**
 * One registered slash command.
 *
 * `name` is canonical (no leading `/`); the user types either form.
 * `description` is rendered under the input as a one-line preview.
 * `aliases` lets one command match multiple typed strings (e.g. `/q` for
 * `/quit`). Optional — many commands have just the canonical name.
 *
 * Note that `dispatch` returns void (synchronous) — async commands like
 * `/login` `/logout` kick off their own promises and surface state via
 * the toast / store. The palette closes immediately so the parent screen
 * can resume rendering while the side-effect runs in the background.
 */
export interface SlashCommand {
  name: string;
  description: string;
  aliases?: string[];
  dispatch: (ctx: SlashCommandContext) => void;
}

/** Closure injected into each command's dispatch. */
export interface SlashCommandContext {
  exit: () => void;
}

/**
 * Pure registry. Exported so the palette test can iterate the list and
 * assert on command names without spinning up a render.
 */
export function buildCommandRegistry(): SlashCommand[] {
  return [
    {
      name: "login",
      description: "Open browser to sign in to autousers.ai",
      dispatch: () => {
        // Best-effort — failures surface via the menu's auth status banner
        // when the user lands back on the menu screen. We swallow the
        // promise here rather than awaiting because the palette is
        // synchronous on close.
        void startTuiLogin().catch(() => {
          useTUIStore.getState().setToast({
            kind: "error",
            message: "Sign-in failed. Try `l` from the main menu.",
          });
        });
        useTUIStore.getState().setToast({
          kind: "info",
          message: "Opening your browser to sign in…",
        });
      },
    },
    {
      name: "logout",
      description: "Revoke server token and clear local config",
      dispatch: () => {
        void tuiLogout()
          .then(() => {
            useTUIStore.getState().setToast({
              kind: "success",
              message: "Signed out.",
            });
          })
          .catch(() => {
            useTUIStore.getState().setToast({
              kind: "error",
              message: "Sign-out failed. Try again.",
            });
          });
      },
    },
    {
      name: "upgrade",
      description: "Open the billing page in your browser",
      dispatch: () => {
        openUrl(BILLING_URL);
        useTUIStore.getState().setToast({
          kind: "info",
          message: `Opened ${BILLING_URL}`,
        });
      },
    },
    {
      name: "help",
      description: "Open the autousers.ai help center",
      dispatch: () => {
        openUrl(HELP_FALLBACK_URL);
        useTUIStore.getState().setToast({
          kind: "info",
          message: `Opened ${HELP_FALLBACK_URL}`,
        });
      },
    },
    {
      name: "team",
      description: "Switch the active team",
      dispatch: () => {
        const { authUser, setScreen } = useTUIStore.getState();
        if (!authUser) {
          useTUIStore.getState().setToast({
            kind: "info",
            message: "Sign in first with /login.",
          });
          return;
        }
        setScreen("teams-section");
      },
    },
    {
      name: "settings",
      description: "Open the settings screen",
      dispatch: () => {
        const { authUser, setScreen } = useTUIStore.getState();
        if (!authUser) {
          useTUIStore.getState().setToast({
            kind: "info",
            message: "Sign in first with /login.",
          });
          return;
        }
        setScreen("settings");
      },
    },
    {
      name: "version",
      description: "Show the CLI version",
      dispatch: () => {
        useTUIStore.getState().setToast({
          kind: "info",
          message: `autousers/${CLI_VERSION} (node ${process.version}, ${process.platform})`,
        });
      },
    },
    {
      name: "quit",
      aliases: ["q", "exit"],
      description: "Exit the TUI",
      dispatch: ({ exit }) => {
        exit();
      },
    },
  ];
}

/**
 * Find the matching command for `typed`, supporting both canonical names
 * and aliases. The match is case-insensitive and ignores any leading `/`
 * — users can type `/logout` or `logout`, and the palette dispatches
 * either way.
 *
 * Returns the command if exactly one matches AT THE CURRENT TYPED STATE
 * (substring match for the autocomplete suffix; exact match for dispatch).
 * Used in two distinct ways:
 *
 *   - `findExactMatch(typed)` → only matches `name`/`alias === typed`. The
 *     dispatcher uses this so a half-typed `lo` doesn't accidentally fire
 *     `/logout`.
 *   - `findPrefixMatch(typed)` → matches by `startsWith`. The autocomplete
 *     hint uses this so the grey suffix renders only when the user has a
 *     unique disambiguation in front of them.
 */
export function findExactMatch(
  registry: SlashCommand[],
  typed: string
): SlashCommand | null {
  const normalized = typed.replace(/^\//, "").toLowerCase().trim();
  if (!normalized) return null;
  for (const cmd of registry) {
    if (cmd.name === normalized) return cmd;
    if (cmd.aliases?.includes(normalized)) return cmd;
  }
  return null;
}

export function findPrefixMatch(
  registry: SlashCommand[],
  typed: string
): SlashCommand | null {
  const normalized = typed.replace(/^\//, "").toLowerCase().trim();
  if (!normalized) return null;
  // Prefix match against the canonical name first; aliases are typically
  // shorter and would shadow the canonical autocompletion target.
  const matches = registry.filter((cmd) => cmd.name.startsWith(normalized));
  if (matches.length === 1) return matches[0]!;
  return null;
}

/**
 * Renders the palette modal when `commandPaletteOpen` is true. Owns
 * `useInput` for the duration it's mounted; un-mounts (and releases input)
 * the moment the store flips closed.
 *
 * The component takes no props — it pulls open / value / setters from the
 * store directly. Tests render it with the store pre-set into the open
 * state so the input handler is live.
 */
export function CommandPalette() {
  const { exit } = useApp();
  const open = useTUIStore((s) => s.commandPaletteOpen);
  const value = useTUIStore((s) => s.commandPaletteValue);
  const setOpen = useTUIStore((s) => s.setCommandPaletteOpen);
  const setValue = useTUIStore((s) => s.setCommandPaletteValue);

  // Local cursor position. We don't expose this in the store because it's
  // visual-only — no other component needs to read where the user is in
  // the line. Kept in a `useState` so re-renders track it the way they do
  // for `value`. Defaults to end-of-string so reopening with a (rare)
  // pre-seeded value doesn't drop the caret at column zero.
  const [cursor, setCursor] = useState(value.length);

  const [registry] = useState(() => buildCommandRegistry());

  if (!open) return null;

  const exactMatch = findExactMatch(registry, value);
  const prefixMatch = findPrefixMatch(registry, value);
  const autocompleteSuffix =
    !exactMatch && prefixMatch
      ? prefixMatch.name.slice(value.replace(/^\//, "").length)
      : "";

  return (
    <CommandPaletteInput
      value={value}
      cursor={cursor}
      setValue={setValue}
      setCursor={setCursor}
      autocompleteSuffix={autocompleteSuffix}
      matchedDescription={
        exactMatch?.description ?? prefixMatch?.description ?? null
      }
      onClose={() => setOpen(false)}
      onSubmit={(typed) => {
        const cmd = findExactMatch(registry, typed);
        if (!cmd) {
          // Show the user what we couldn't dispatch and keep the palette
          // open so they can correct the typo. The toast clears on its own
          // via the auto-dismiss producer in `app.tsx`.
          useTUIStore.getState().setToast({
            kind: "error",
            message: `Unknown command: /${typed.replace(/^\//, "")}`,
          });
          return;
        }
        // Close BEFORE dispatch so the dispatched command can route screens
        // / open browsers without the palette overlay still rendered on top.
        setOpen(false);
        cmd.dispatch({ exit });
      }}
      onTabComplete={() => {
        if (prefixMatch && !exactMatch) {
          const completed = prefixMatch.name;
          setValue(completed);
          setCursor(completed.length);
        }
      }}
      knownCommands={registry}
    />
  );
}

/**
 * Pure input component. Split out so the input handling can be tested in
 * isolation from the store wiring — the test mounts this directly with
 * spy callbacks instead of having to seed the store and walk through the
 * top-level `<CommandPalette>` wrapper.
 */
interface CommandPaletteInputProps {
  value: string;
  cursor: number;
  setValue: (v: string) => void;
  setCursor: (c: number) => void;
  autocompleteSuffix: string;
  matchedDescription: string | null;
  onClose: () => void;
  onSubmit: (value: string) => void;
  onTabComplete: () => void;
  knownCommands: SlashCommand[];
}

export function CommandPaletteInput({
  value,
  cursor,
  setValue,
  setCursor,
  autocompleteSuffix,
  matchedDescription,
  onClose,
  onSubmit,
  onTabComplete,
  knownCommands,
}: CommandPaletteInputProps) {
  useInput((input, key) => {
    if (key.escape) {
      onClose();
      return;
    }
    if (key.return) {
      onSubmit(value);
      return;
    }
    if (key.tab) {
      onTabComplete();
      return;
    }
    if (key.backspace || key.delete) {
      if (cursor > 0) {
        const next = value.slice(0, cursor - 1) + value.slice(cursor);
        setValue(next);
        setCursor(cursor - 1);
      }
      return;
    }
    if (key.leftArrow) {
      setCursor(Math.max(0, cursor - 1));
      return;
    }
    if (key.rightArrow) {
      setCursor(Math.min(value.length, cursor + 1));
      return;
    }
    // Ignore unhandled control sequences — up/down arrows are reserved
    // for a future history feature, ctrl-c bubbles to the app's quit
    // handler if anything is listening above us.
    if (key.upArrow || key.downArrow || (key.ctrl && input === "c")) {
      return;
    }
    if (input) {
      const next = value.slice(0, cursor) + input + value.slice(cursor);
      setValue(next);
      setCursor(cursor + input.length);
    }
  });

  // Render value with cursor + dim autocomplete suffix.
  //
  // When the cursor sits at end-of-string AND we have an autocomplete
  // suffix, show the cursor block on the first character of the suffix
  // (dim — visually distinct from typed text so the user can tell what
  // Tab would commit). This keeps the rendered line tight: `/up[grade]`
  // rather than `/up [grade]` with a stray cursor-space separating them.
  const atEndOfTyped = cursor >= value.length;
  const before = value.slice(0, cursor);
  const after = cursor < value.length ? value.slice(cursor + 1) : "";
  const cursorChar =
    value[cursor] ??
    (atEndOfTyped && autocompleteSuffix ? autocompleteSuffix[0] : " ");
  const trailingSuffix =
    atEndOfTyped && autocompleteSuffix
      ? autocompleteSuffix.slice(1)
      : autocompleteSuffix;

  return (
    <Box flexDirection="column" paddingX={1} marginY={1}>
      <Box
        borderStyle="round"
        borderColor={Theme.brand}
        flexDirection="column"
        paddingX={1}
        paddingY={0}
      >
        <Box>
          <Text color={Theme.brand} bold>
            /
          </Text>
          <Text>{before}</Text>
          <Text inverse dimColor={atEndOfTyped && Boolean(autocompleteSuffix)}>
            {cursorChar}
          </Text>
          <Text>{after}</Text>
          {trailingSuffix ? <Text dimColor>{trailingSuffix}</Text> : null}
        </Box>
        {matchedDescription ? (
          <Box marginTop={1}>
            <Text dimColor>{matchedDescription}</Text>
          </Box>
        ) : (
          <Box marginTop={1}>
            <Text dimColor>
              {`${knownCommands.length} commands · Tab autocomplete · Enter run · Esc close`}
            </Text>
          </Box>
        )}
      </Box>
    </Box>
  );
}
