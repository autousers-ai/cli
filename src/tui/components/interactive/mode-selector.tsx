/**
 * Main menu / mode selector for the autousers TUI.
 *
 * Ported from uxrater's `cli/components/interactive/mode-selector.tsx`,
 * adapted to autousers' six top-level destinations. Each menu item routes
 * into a screen owned by a later wave (eval creator → Wave 4, eval history
 * → Wave 7, autouser hub → Wave 8, template hub + settings → Wave 9). For
 * now the routing target is `screen: "placeholder"` plus a
 * `placeholderTarget` discriminator so wave-4-9 work knows which screen
 * the user picked when they replace placeholder rendering with their own.
 *
 * The "Logout" item is the one menu option that fully ships in Wave 3 —
 * triggers {@link tuiLogout}, which revokes server-side and clears the
 * store. We also wire the `l` keybind globally so users can sign in /
 * out from anywhere on the menu without scrolling to row 6.
 *
 * Keybinds:
 *   - ↑↓        Navigate between items
 *   - Enter     Select highlighted item
 *   - 1-6       Quick-select by item number
 *   - q         Quit the TUI (handled by the parent App)
 *   - l         Toggle login/logout (handled here AND in the parent so it
 *               works on every screen — the parent's handler swallows the
 *               input on screens we own; we react first when focused)
 *   - ?         Show keybind help (Wave 4 will turn this into a modal;
 *               for now we render the legend inline below the menu)
 *   - Esc       (no-op on the main menu — there's nothing to back out of)
 *
 * Why the keybinds live here rather than App
 * ------------------------------------------
 * `useInput` only fires for the focused component, and Ink's focus model
 * is implicit (the most recently mounted `useInput` wins). Keeping the
 * navigation handlers next to the rendered list means the `1-6` and ↑↓
 * behaviour can't drift if a future screen wraps the menu.
 */
import { useState } from "react";
import { Box, Text, useInput } from "@jrichman/ink";

import {
  useTUIStore,
  type PlaceholderTarget,
  type Screen,
} from "../../state.js";
import { Theme } from "../../theme.js";
import { startTuiLogin, tuiLogout } from "../../auth-flow.js";

/**
 * One row in the menu. `screen` + optional `placeholderTarget` describe
 * where Enter takes the user; `action` is reserved for items that don't
 * route a screen change (login/logout, quit-confirms, etc.).
 */
interface MenuItem {
  /** Numeric key for quick-select. Numbered 1..N matching display order. */
  key: string;
  /** Bold short label, shown next to the index. */
  label: string;
  /** Dim subtitle, shown to the right of the label. */
  description: string;
  /** Screen to route to on Enter. Omit when `action` is set. */
  screen?: Screen;
  /** When `screen === "placeholder"`, which placeholder target. */
  placeholderTarget?: PlaceholderTarget;
  /** Custom handler for items that don't simply switch screens. */
  action?: "logout";
}

/**
 * The six top-level menu items the brief mandates. Indexes 1-5 ship as
 * placeholders that wave-4-9 work replaces; index 6 (Logout) ships fully
 * in Wave 3.
 */
const MENU_ITEMS: MenuItem[] = [
  {
    key: "1",
    label: "Create new evaluation",
    description: "Wizard: type, URLs, autouser, dimensions, run config",
    // Wave 4 lands the real eval-creation wizard, so this menu item now
    // routes to a first-class screen rather than the wave-3 placeholder.
    // Compare to items 2-5 which still hold a `placeholderTarget` until
    // their owning waves (7-9) land their respective screens.
    screen: "eval-creator",
  },
  {
    key: "2",
    label: "Browse evaluations",
    description: "View past runs, drill into results, share / export",
    // Wave 7 lands the real eval-history browser, so item 2 routes
    // directly to it rather than through the wave-3 placeholder.
    screen: "eval-history",
  },
  {
    key: "3",
    label: "Manage autousers",
    description: "Create, calibrate, edit, duplicate AI personas",
    // Wave 8 lands the real autoraters-hub screen, so item 3 routes
    // directly to it rather than through the wave-3 placeholder.
    screen: "autoraters-hub",
  },
  {
    key: "4",
    label: "Manage templates",
    description: "Dimensions, scoring scales, rubrics",
    // Wave 9 lands the real templates-hub screen, so item 4 routes
    // directly to it rather than through the placeholder.
    screen: "templates-hub",
  },
  {
    key: "5",
    label: "Settings",
    description: "Teams, BYOK, API keys, defaults",
    // Wave 9 lands the real settings screen, so item 5 routes
    // directly to it rather than through the placeholder.
    screen: "settings",
  },
  {
    key: "6",
    label: "Logout",
    description: "Revoke server-side tokens and clear local credentials",
    action: "logout",
  },
];

/** Width reserved for the label column so descriptions align consistently. */
const LABEL_WIDTH = 26;

/**
 * Render a single menu row. Extracted to keep the main component readable.
 * The `>` caret highlights the focused row in brand blue; non-focused
 * rows render dim so the highlighted one pops without coloring everything.
 */
function MenuRow({
  item,
  selected,
  dim = false,
}: {
  item: MenuItem;
  selected: boolean;
  dim?: boolean;
}) {
  return (
    <Box>
      <Text
        color={selected ? Theme.brand : undefined}
        bold={selected}
        dimColor={dim && !selected}
      >
        {selected ? "> " : "  "}
      </Text>
      <Text bold={selected} dimColor={dim && !selected}>
        {item.key}{" "}
      </Text>
      <Box width={LABEL_WIDTH}>
        <Text bold={selected} dimColor={dim && !selected}>
          {item.label}
        </Text>
      </Box>
      <Text dimColor>{item.description}</Text>
    </Box>
  );
}

interface ModeSelectorProps {
  /** Override the API host. Threaded through to the OAuth flow. */
  baseUrl?: string;
  /** Disable browser auto-open (SSH / headless). Default `true`. */
  openBrowser?: boolean;
}

export function ModeSelector({ baseUrl, openBrowser }: ModeSelectorProps = {}) {
  const [selected, setSelected] = useState(0);
  const [authStatus, setAuthStatus] = useState<
    "idle" | "pending" | "success" | "error"
  >("idle");
  const [authError, setAuthError] = useState<string | null>(null);
  const [showHelp, setShowHelp] = useState(false);

  const setScreen = useTUIStore((s) => s.setScreen);
  const setPlaceholderTarget = useTUIStore((s) => s.setPlaceholderTarget);
  const authUser = useTUIStore((s) => s.authUser);

  const triggerLogin = (): void => {
    if (authStatus === "pending") return;
    setAuthError(null);
    setAuthStatus("pending");
    startTuiLogin({ baseUrl, openBrowser })
      .then(() => {
        setAuthStatus("success");
        // Auto-clear the success banner so it doesn't linger forever.
        setTimeout(() => setAuthStatus("idle"), 2500);
      })
      .catch((err: unknown) => {
        setAuthError(err instanceof Error ? err.message : String(err));
        setAuthStatus("error");
        setTimeout(() => {
          setAuthStatus("idle");
          setAuthError(null);
        }, 4000);
      });
  };

  const triggerLogout = (): void => {
    if (authStatus === "pending") return;
    setAuthError(null);
    setAuthStatus("pending");
    tuiLogout({ baseUrl })
      .then(() => {
        setAuthStatus("success");
        setTimeout(() => setAuthStatus("idle"), 2000);
      })
      .catch((err: unknown) => {
        setAuthError(err instanceof Error ? err.message : String(err));
        setAuthStatus("error");
        setTimeout(() => {
          setAuthStatus("idle");
          setAuthError(null);
        }, 4000);
      });
  };

  const select = (item: MenuItem): void => {
    // Auth gate: every menu item except Logout requires a signed-in user.
    // Selecting any other item without auth triggers the login flow instead
    // of routing to a screen that would 401 immediately.
    if (item.action === "logout") {
      triggerLogout();
      return;
    }
    if (!authUser) {
      triggerLogin();
      return;
    }
    if (item.screen === "placeholder" && item.placeholderTarget) {
      setPlaceholderTarget(item.placeholderTarget);
      setScreen("placeholder");
      return;
    }
    if (item.screen) {
      setScreen(item.screen);
    }
  };

  useInput((input, key) => {
    // Don't react to key input mid-auth — the OAuth flow has its own
    // browser tab and waiting state, and racing key events against the
    // callback resolution leads to confusing UI flicker.
    if (authStatus === "pending") return;

    if (key.upArrow) {
      setSelected((prev) => Math.max(0, prev - 1));
      return;
    }
    if (key.downArrow) {
      setSelected((prev) => Math.min(MENU_ITEMS.length - 1, prev + 1));
      return;
    }
    if (key.return) {
      const item = MENU_ITEMS[selected];
      if (item) select(item);
      return;
    }
    // Quick-select by digit. We only register 1..MENU_ITEMS.length so a
    // stray "9" press doesn't blow past the last item.
    if (input >= "1" && input <= String(MENU_ITEMS.length)) {
      const idx = parseInt(input, 10) - 1;
      const item = MENU_ITEMS[idx];
      if (item) {
        setSelected(idx);
        select(item);
      }
      return;
    }
    if (input === "l") {
      if (authUser) {
        triggerLogout();
      } else {
        triggerLogin();
      }
      return;
    }
    if (input === "?") {
      setShowHelp((v) => !v);
      return;
    }
  });

  // Signed-out: render ONLY the sign-in prompt. We hide the main menu
  // entirely until auth completes — leaving it visible-but-dimmed was
  // confusing because the up/down arrows still moved the highlight even
  // though every selection forced login. Cleaner: nothing to navigate
  // until you're signed in.
  if (!authUser) {
    return (
      <Box flexDirection="column" paddingX={1} marginY={1}>
        <Box
          borderStyle="round"
          borderColor={Theme.brand}
          flexDirection="column"
          paddingX={2}
          paddingY={1}
        >
          <Text color={Theme.brand} bold>
            Sign in to continue
          </Text>
          <Box marginTop={1}>
            {authStatus === "pending" ? (
              <Text color={Theme.brand}>
                Opening your browser… complete the sign-in there, then return
                here.
              </Text>
            ) : (
              <Text>
                Press{" "}
                <Text color={Theme.brand} bold>
                  l
                </Text>{" "}
                to open your browser and sign in to autousers.ai.
              </Text>
            )}
          </Box>
          <Box marginTop={1}>
            <Text dimColor>
              Once signed in you can create evaluations, run autousers, and
              manage your team.
            </Text>
          </Box>
        </Box>

        {authStatus === "error" && authError && (
          <Box paddingTop={1}>
            <Text color={Theme.error}>Auth failed: {authError}</Text>
          </Box>
        )}
      </Box>
    );
  }

  return (
    <Box flexDirection="column" paddingX={1} marginY={1}>
      <Box
        borderStyle="single"
        borderColor={Theme.brand}
        flexDirection="column"
        paddingX={1}
        paddingY={0}
      >
        <Text color={Theme.brand} bold>
          Main menu
        </Text>
        <Box flexDirection="column" paddingTop={1}>
          {MENU_ITEMS.map((item, i) => (
            <MenuRow key={item.key} item={item} selected={i === selected} />
          ))}
        </Box>
      </Box>

      {authStatus === "pending" && (
        <Box paddingTop={1}>
          <Text color={Theme.brand}>
            Opening your browser to sign in... (press Esc in the browser tab to
            cancel)
          </Text>
        </Box>
      )}
      {authStatus === "success" && (
        <Box paddingTop={1}>
          <Text color={Theme.success}>
            {authUser ? "Signed in." : "Signed out."}
          </Text>
        </Box>
      )}
      {authStatus === "error" && authError && (
        <Box paddingTop={1}>
          <Text color={Theme.error}>Auth failed: {authError}</Text>
        </Box>
      )}

      {showHelp && (
        <Box
          marginTop={1}
          borderStyle="single"
          borderColor="gray"
          paddingX={1}
          flexDirection="column"
        >
          <Text bold>Keybinds</Text>
          <Text dimColor>↑↓ navigate · Enter select · 1-6 quick-select</Text>
          <Text dimColor>l login/logout · ? toggle help · q quit</Text>
        </Box>
      )}
    </Box>
  );
}
