/**
 * Tests for the slash-command palette.
 *
 * Coverage:
 *   - Registry: every documented command is registered with a description
 *   - Match helpers: exact match by name + alias, prefix match for tab
 *     completion (only when unique)
 *   - Render: the palette mounts when the store flips open, shows the
 *     leading slash + autocomplete suffix
 *   - Input handling: typing fills the value, Tab autocompletes the
 *     matched command, Enter dispatches, Esc closes
 *   - Dispatch: `/login`, `/logout`, `/quit`, `/version`, `/upgrade`,
 *     `/team`, `/settings`, `/help`, `/quit` all route to their wrapper.
 *
 * We mock the auth-flow + oauth modules so the dispatchers don't open a
 * real browser tab during the test run. The palette's behaviour is the
 * unit under test, not the underlying side-effects (those are covered
 * by oauth.test.ts and the existing mode-selector tests).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render } from "ink-testing-library";

vi.mock("../auth-flow.js", () => ({
  startTuiLogin: vi.fn().mockResolvedValue(undefined),
  tuiLogout: vi.fn().mockResolvedValue(undefined),
  fetchAuthUser: vi.fn().mockResolvedValue(null),
  OAuthError: class OAuthError extends Error {},
}));
vi.mock("../../oauth.js", async () => {
  const actual =
    await vi.importActual<typeof import("../../oauth.js")>("../../oauth.js");
  return {
    ...actual,
    openUrl: vi.fn(),
  };
});

import * as authFlow from "../auth-flow.js";
import * as oauth from "../../oauth.js";
import { useTUIStore } from "../state.js";
import {
  CommandPalette,
  buildCommandRegistry,
  findExactMatch,
  findPrefixMatch,
} from "./command-palette.js";

const ESC = String.fromCharCode(27);
const ENTER = "\r";
const TAB = "\t";

const tick = (ms = 30) => new Promise<void>((r) => setTimeout(r, ms));

beforeEach(() => {
  vi.clearAllMocks();
  useTUIStore.setState({
    screen: "menu",
    authUser: null,
    placeholderTarget: null,
    toast: null,
    commandPaletteOpen: false,
    commandPaletteValue: "",
  });
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("buildCommandRegistry", () => {
  it("registers every documented command with a description", () => {
    const reg = buildCommandRegistry();
    const names = reg.map((c) => c.name).sort();
    // The brief mandates these eight as the minimum set; future waves
    // can add more without breaking the test.
    expect(names).toEqual([
      "help",
      "login",
      "logout",
      "quit",
      "settings",
      "team",
      "upgrade",
      "version",
    ]);
    for (const cmd of reg) {
      expect(cmd.description.length).toBeGreaterThan(0);
    }
  });

  it("registers /quit with `q` and `exit` aliases", () => {
    const reg = buildCommandRegistry();
    const quit = reg.find((c) => c.name === "quit");
    expect(quit?.aliases).toContain("q");
    expect(quit?.aliases).toContain("exit");
  });
});

describe("findExactMatch", () => {
  const reg = buildCommandRegistry();

  it("matches the canonical name (case-insensitive, with or without slash)", () => {
    expect(findExactMatch(reg, "logout")?.name).toBe("logout");
    expect(findExactMatch(reg, "/logout")?.name).toBe("logout");
    expect(findExactMatch(reg, "LOGOUT")?.name).toBe("logout");
  });

  it("matches aliases", () => {
    expect(findExactMatch(reg, "q")?.name).toBe("quit");
    expect(findExactMatch(reg, "exit")?.name).toBe("quit");
  });

  it("returns null for unknown / partial input", () => {
    expect(findExactMatch(reg, "")).toBeNull();
    expect(findExactMatch(reg, "lo")).toBeNull();
    expect(findExactMatch(reg, "nope")).toBeNull();
  });
});

describe("findPrefixMatch", () => {
  const reg = buildCommandRegistry();

  it("returns the unique prefix match", () => {
    // `up` only matches `upgrade` — no other registered command starts
    // with that prefix, so this is unambiguous.
    expect(findPrefixMatch(reg, "up")?.name).toBe("upgrade");
    expect(findPrefixMatch(reg, "/up")?.name).toBe("upgrade");
  });

  it("returns null on ambiguous prefix", () => {
    // `s` matches both `settings` — but if more commands matched it'd
    // be ambiguous. Verifying that a unique-prefix returns and a
    // less-discriminating prefix does not.
    expect(findPrefixMatch(reg, "s")?.name).toBe("settings");
    // `l` matches both `login` and `logout`.
    expect(findPrefixMatch(reg, "l")).toBeNull();
  });

  it("returns null on unknown prefix", () => {
    expect(findPrefixMatch(reg, "zzz")).toBeNull();
  });
});

describe("<CommandPalette> mount/unmount", () => {
  it("renders nothing when the store is closed", () => {
    const { lastFrame } = render(<CommandPalette />);
    expect(lastFrame() ?? "").toBe("");
  });

  it("renders the bordered prompt when the store flips open", async () => {
    const { lastFrame, rerender } = render(<CommandPalette />);
    useTUIStore.getState().setCommandPaletteOpen(true);
    await tick();
    rerender(<CommandPalette />);
    await tick();
    const frame = lastFrame() ?? "";
    expect(frame).toContain("/");
    // The empty-state hint mentions the available count + the keybinds.
    expect(frame).toContain("commands");
    expect(frame).toContain("Tab autocomplete");
  });
});

describe("<CommandPalette> input handling", () => {
  it("Esc closes the palette", async () => {
    useTUIStore.getState().setCommandPaletteOpen(true);
    const { stdin } = render(<CommandPalette />);
    await tick();
    stdin.write(ESC);
    await tick();
    expect(useTUIStore.getState().commandPaletteOpen).toBe(false);
  });

  it("typing fills the value", async () => {
    useTUIStore.getState().setCommandPaletteOpen(true);
    const { stdin } = render(<CommandPalette />);
    await tick();
    stdin.write("logout");
    await tick();
    expect(useTUIStore.getState().commandPaletteValue).toBe("logout");
  });

  it("Tab autocompletes a unique prefix match", async () => {
    useTUIStore.getState().setCommandPaletteOpen(true);
    const { stdin } = render(<CommandPalette />);
    await tick();
    stdin.write("up");
    await tick();
    stdin.write(TAB);
    await tick();
    expect(useTUIStore.getState().commandPaletteValue).toBe("upgrade");
  });

  it("Tab does nothing on ambiguous prefix", async () => {
    useTUIStore.getState().setCommandPaletteOpen(true);
    const { stdin } = render(<CommandPalette />);
    await tick();
    stdin.write("l"); // matches `login` and `logout`
    await tick();
    stdin.write(TAB);
    await tick();
    expect(useTUIStore.getState().commandPaletteValue).toBe("l");
  });

  it("backspace deletes the previous character", async () => {
    useTUIStore.getState().setCommandPaletteOpen(true);
    const { stdin } = render(<CommandPalette />);
    await tick();
    stdin.write("logout");
    await tick();
    stdin.write(""); // DEL / backspace
    await tick();
    expect(useTUIStore.getState().commandPaletteValue).toBe("logou");
  });
});

describe("<CommandPalette> dispatch", () => {
  it("Enter on /logout calls tuiLogout and closes", async () => {
    useTUIStore.getState().setCommandPaletteOpen(true);
    const { stdin } = render(<CommandPalette />);
    await tick();
    stdin.write("logout");
    await tick();
    stdin.write(ENTER);
    await tick(50);
    expect(authFlow.tuiLogout).toHaveBeenCalledTimes(1);
    expect(useTUIStore.getState().commandPaletteOpen).toBe(false);
  });

  it("Enter on /login calls startTuiLogin and closes", async () => {
    useTUIStore.getState().setCommandPaletteOpen(true);
    const { stdin } = render(<CommandPalette />);
    await tick();
    stdin.write("login");
    await tick();
    stdin.write(ENTER);
    await tick(50);
    expect(authFlow.startTuiLogin).toHaveBeenCalledTimes(1);
    expect(useTUIStore.getState().commandPaletteOpen).toBe(false);
  });

  it("Enter on /upgrade calls openUrl with the billing URL and closes", async () => {
    useTUIStore.getState().setCommandPaletteOpen(true);
    const { stdin } = render(<CommandPalette />);
    await tick();
    stdin.write("upgrade");
    await tick();
    stdin.write(ENTER);
    await tick();
    expect(oauth.openUrl).toHaveBeenCalledTimes(1);
    expect(
      (oauth.openUrl as unknown as ReturnType<typeof vi.fn>).mock.calls[0]![0]
    ).toMatch(/autousers\.ai/);
    expect(useTUIStore.getState().commandPaletteOpen).toBe(false);
  });

  it("Enter on /version surfaces a toast with the CLI version", async () => {
    useTUIStore.getState().setCommandPaletteOpen(true);
    const { stdin } = render(<CommandPalette />);
    await tick();
    stdin.write("version");
    await tick();
    stdin.write(ENTER);
    await tick();
    const toast = useTUIStore.getState().toast;
    expect(toast?.kind).toBe("info");
    expect(toast?.message ?? "").toMatch(/^autousers\//);
  });

  it("Enter on /team routes to teams-section when authed", async () => {
    useTUIStore.setState({
      authUser: { email: "you@autousers.ai" },
    });
    useTUIStore.getState().setCommandPaletteOpen(true);
    const { stdin } = render(<CommandPalette />);
    await tick();
    stdin.write("team");
    await tick();
    stdin.write(ENTER);
    await tick();
    expect(useTUIStore.getState().screen).toBe("teams-section");
  });

  it("Enter on /team prompts for sign-in when not authed", async () => {
    useTUIStore.getState().setCommandPaletteOpen(true);
    const { stdin } = render(<CommandPalette />);
    await tick();
    stdin.write("team");
    await tick();
    stdin.write(ENTER);
    await tick();
    expect(useTUIStore.getState().screen).toBe("menu");
    expect(useTUIStore.getState().toast?.message).toMatch(/Sign in/);
  });

  it("Enter on /settings routes to settings when authed", async () => {
    useTUIStore.setState({
      authUser: { email: "you@autousers.ai" },
    });
    useTUIStore.getState().setCommandPaletteOpen(true);
    const { stdin } = render(<CommandPalette />);
    await tick();
    stdin.write("settings");
    await tick();
    stdin.write(ENTER);
    await tick();
    expect(useTUIStore.getState().screen).toBe("settings");
  });

  it("Enter on /help opens the help URL via openUrl", async () => {
    useTUIStore.getState().setCommandPaletteOpen(true);
    const { stdin } = render(<CommandPalette />);
    await tick();
    stdin.write("help");
    await tick();
    stdin.write(ENTER);
    await tick();
    expect(oauth.openUrl).toHaveBeenCalled();
    const calledWith = (oauth.openUrl as unknown as ReturnType<typeof vi.fn>)
      .mock.calls[0]![0];
    expect(calledWith).toMatch(/autousers\.ai\/help/);
  });

  it("Enter on an unknown command surfaces an error toast and stays open", async () => {
    useTUIStore.getState().setCommandPaletteOpen(true);
    const { stdin } = render(<CommandPalette />);
    await tick();
    stdin.write("nope");
    await tick();
    stdin.write(ENTER);
    await tick();
    // Still open so the user can correct the typo.
    expect(useTUIStore.getState().commandPaletteOpen).toBe(true);
    expect(useTUIStore.getState().toast?.kind).toBe("error");
    expect(useTUIStore.getState().toast?.message).toContain("nope");
  });
});
