/**
 * Root TUI component for the autousers CLI.
 *
 * Wave 3 wired in screen routing via the zustand store. Wave 4 lands the
 * first real wave-4-9 screen (`eval-creator`) — the menu's "Create new
 * evaluation" item routes here directly rather than through the
 * placeholder, and this component mounts {@link EvalCreator} when
 * `screen === "eval-creator"`. Esc inside the creator returns to the
 * menu (handled inside the screen).
 *
 * The `welcome` screen is reserved for a future first-run onboarding
 * flow (Wave 9 may revive it for the API-keys / BYOK setup walkthrough);
 * the default screen out of the gate is `menu`.
 *
 * Mounted from `src/index.ts` only when `shouldUseTUI()` returns true.
 */
import { useEffect } from "react";
import { Box, Text, useApp, useInput, render } from "@jrichman/ink";

import { fetchAuthUser } from "./auth-flow.js";
import { CommandPalette } from "./components/command-palette.js";
import { Dashboard } from "./components/dashboard/index.js";
import { Footer } from "./components/footer.js";
import { Header } from "./components/header.js";
import { ModeSelector } from "./components/interactive/index.js";
import { ResultsView } from "./components/results/index.js";
import { AutoraterCalibration } from "./components/screens/autorater-calibration.js";
import { AutoraterCreator } from "./components/screens/autorater-creator.js";
import { AutoratersHub } from "./components/screens/autoraters-hub.js";
import { ConnectedAppsSection } from "./components/screens/connected-apps-section.js";
import { EvalCreator } from "./components/screens/eval-creator.js";
import { EvalHistory } from "./components/screens/eval-history.js";
import { EvalResultsView } from "./components/screens/eval-results-view.js";
import { Settings } from "./components/screens/settings.js";
import { TeamsSection } from "./components/screens/teams-section.js";
import { TemplateCreator } from "./components/screens/template-creator.js";
import { TemplatesHub } from "./components/screens/templates-hub.js";
import { UsageSection } from "./components/screens/usage-section.js";
import { useTUIStore } from "./state.js";
import { Theme } from "./theme.js";

/**
 * Body for the placeholder screen. Each menu item that routes through
 * `placeholder` lands here until the corresponding wave (7-9) replaces it
 * with a real screen. Esc → back to the menu.
 *
 * Wave 4 dropped the eval-creator entry — that screen now owns its own
 * route. Items 2-5 still land here until Waves 7-9 ship their screens.
 */
function PlaceholderBody() {
  const target = useTUIStore((s) => s.placeholderTarget);
  const setScreen = useTUIStore((s) => s.setScreen);
  const setPlaceholderTarget = useTUIStore((s) => s.setPlaceholderTarget);

  useInput((_input, key) => {
    if (key.escape) {
      setPlaceholderTarget(null);
      setScreen("menu");
    }
  });

  // Wave-by-wave, this map shrinks as later waves replace each placeholder
  // with a real screen. Wave 7 dropped `eval-history`, Wave 8 dropped
  // `autouser-hub`, Wave 9 dropped `template-hub` and `settings` — every
  // top-level menu destination now has a real screen, so the placeholder
  // body only renders when a future wave routes a fresh placeholderTarget
  // here. The empty record keeps the type contract honest while the
  // surface is intentionally inert.
  const labels: Record<string, { name: string; wave: string }> = {};
  const meta = target ? labels[target] : null;

  return (
    <Box flexDirection="column" paddingX={2} marginY={1}>
      <Text color={Theme.brand} bold>
        {meta?.name ?? "Coming soon"}
      </Text>
      <Box marginTop={1}>
        <Text dimColor>
          {meta
            ? `${meta.name} ships in ${meta.wave}. For now, drop back to the menu with Esc and use the plain-mode commands (autousers --help) for what's already wired up.`
            : "This screen ships in a later wave. Press Esc to return to the main menu."}
        </Text>
      </Box>
      <Box marginTop={1}>
        <Text dimColor>Esc → main menu</Text>
      </Box>
    </Box>
  );
}

/**
 * Body for the `loading-auth` screen. Shown briefly during the OAuth
 * browser flow if the parent decided to surface it as a full-screen state
 * rather than a banner under the menu. The default flow keeps the user
 * on the `menu` screen and renders the banner inline; this screen exists
 * for future flows that want a cleaner "please wait" pane.
 */
function LoadingAuthBody() {
  return (
    <Box flexDirection="column" paddingX={2} marginY={1}>
      <Text color={Theme.brand}>Opening your browser to sign in...</Text>
      <Box marginTop={1}>
        <Text dimColor>Approve the request in the tab that opened.</Text>
        <Text dimColor>This window will update once you're authenticated.</Text>
      </Box>
    </Box>
  );
}

/**
 * Inline toast banner. Wave 4 surfaces it after the eval-creator's confirm
 * step succeeds ("Evaluation queued · Esc returns to menu"). Auto-dismiss
 * is owned by the producer (the screen sets it, then a setTimeout clears
 * it via `setToast(null)`).
 */
function ToastBanner() {
  const toast = useTUIStore((s) => s.toast);
  if (!toast) return null;

  const color =
    toast.kind === "error"
      ? Theme.error
      : toast.kind === "success"
        ? Theme.success
        : Theme.brand;

  return (
    <Box paddingX={2} marginY={1}>
      <Text color={color} bold>
        {toast.message}
      </Text>
    </Box>
  );
}

export function App() {
  const { exit } = useApp();
  const screen = useTUIStore((s) => s.screen);
  const setAuthUser = useTUIStore((s) => s.setAuthUser);
  const commandPaletteOpen = useTUIStore((s) => s.commandPaletteOpen);
  const setCommandPaletteOpen = useTUIStore((s) => s.setCommandPaletteOpen);

  // On mount, attempt to populate the store from any persisted bearer.
  // Failure is non-fatal (the user can still log in via `l`); we don't
  // want a bad config to block the menu from rendering.
  useEffect(() => {
    let cancelled = false;
    fetchAuthUser().then((user) => {
      if (!cancelled) setAuthUser(user);
    });
    return () => {
      cancelled = true;
    };
  }, [setAuthUser]);

  // Screens that own text input (or already overload `/` for in-screen
  // search) get to keep their input contract — the global palette opener
  // and quit handler defer to them. Centralised here so the same gate
  // covers both reactions.
  const screenOwnsInput =
    screen === "eval-creator" ||
    screen === "dashboard" ||
    screen === "results" ||
    screen === "eval-history" ||
    screen === "eval-results-by-id" ||
    screen === "autoraters-hub" ||
    screen === "autorater-creator" ||
    screen === "autorater-calibration" ||
    screen === "templates-hub" ||
    screen === "template-creator" ||
    screen === "settings" ||
    screen === "teams-section" ||
    screen === "usage-section" ||
    screen === "connected-apps-section";

  // Global quit handler. The mode-selector's own `useInput` doesn't fire
  // for `q` (it only handles its own keybinds), so the parent owns this
  // one. ctrl-c is a defensive fallback for terminals that swallow `q`.
  //
  // We disable the parent quit handler whenever a child screen owns text
  // input (eval-creator's URL fields would otherwise eat a `q` typed into
  // a domain name) or when the palette is open (the palette has its own
  // Esc/quit semantics).
  useInput(
    (input, key) => {
      if (input === "q" || (key.ctrl && input === "c")) {
        exit();
      }
    },
    { isActive: !screenOwnsInput && !commandPaletteOpen }
  );

  // Global slash-command opener. Mounts the palette overlay below the
  // current screen when `/` is pressed from a screen that doesn't already
  // overload it. The palette itself owns its own input handler, so we
  // disable this listener while it's open to avoid the user typing `/`
  // inside the palette's input field re-triggering the opener.
  useInput(
    (input) => {
      if (input === "/") {
        setCommandPaletteOpen(true);
      }
    },
    { isActive: !screenOwnsInput && !commandPaletteOpen }
  );

  return (
    <Box flexDirection="column">
      <Header />
      {screen === "menu" || screen === "welcome" ? <ModeSelector /> : null}
      {screen === "placeholder" ? <PlaceholderBody /> : null}
      {screen === "loading-auth" ? <LoadingAuthBody /> : null}
      {screen === "eval-creator" ? <EvalCreator /> : null}
      {screen === "dashboard" || screen === "live-session" ? (
        <Dashboard />
      ) : null}
      {screen === "results" ? <ResultsView /> : null}
      {screen === "eval-history" ? <EvalHistory /> : null}
      {screen === "eval-results-by-id" ? <EvalResultsView /> : null}
      {screen === "autoraters-hub" ? <AutoratersHub /> : null}
      {screen === "autorater-creator" ? <AutoraterCreator /> : null}
      {screen === "autorater-calibration" ? <AutoraterCalibration /> : null}
      {screen === "templates-hub" ? <TemplatesHub /> : null}
      {screen === "template-creator" ? <TemplateCreator /> : null}
      {screen === "settings" ? <Settings /> : null}
      {screen === "teams-section" ? <TeamsSection /> : null}
      {screen === "usage-section" ? <UsageSection /> : null}
      {screen === "connected-apps-section" ? <ConnectedAppsSection /> : null}
      <ToastBanner />
      <CommandPalette />
      <Footer />
    </Box>
  );
}

/**
 * Mount the TUI. Called from `src/index.ts` after `shouldUseTUI()` is true.
 * Returns the Ink render handle so the caller can `await waitUntilExit()`
 * and keep the Node process alive until the user quits.
 */
export function startTUI(): ReturnType<typeof render> {
  return render(<App />);
}
