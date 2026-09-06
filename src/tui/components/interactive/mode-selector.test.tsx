/**
 * Tests for the main-menu mode selector.
 *
 * Coverage:
 *   - All six menu items render with their labels and descriptions
 *   - The "Main menu" title renders inside the bordered box
 *   - Quick-select with a digit (1..6) updates the store the same way
 *     Enter on the highlighted row would
 *   - Down arrow moves the selection downward; up arrow moves it back
 *   - Pressing `?` toggles the help legend
 *   - The logout item triggers `tuiLogout`, not a screen change
 *   - The login keybind (`l`) calls `startTuiLogin` when signed-out and
 *     `tuiLogout` when signed-in
 *
 * Why mock auth-flow rather than oauth.ts directly? The TUI's auth-flow
 * wrapper is the single seam between menu UX and the OAuth orchestrator;
 * mocking the wrapper keeps the tests focused on user-visible behaviour
 * (did the menu route correctly, did it call the right wrapper) without
 * coupling them to PKCE / DCR plumbing that's already covered by
 * `oauth.test.ts`.
 *
 * Async render
 * ------------
 * Ink's input → React-state → render path is asynchronous: writing to
 * stdin queues a setState, which schedules a re-render that
 * ink-testing-library exposes through `lastFrame()`. The frame from a
 * synchronous read right after `stdin.write(...)` is the PRE-input frame,
 * so we yield once via `setImmediate` (`await tick()`) before asserting on
 * the new frame. Same trick uxrater uses internally.
 *
 * Key escape sequences
 * --------------------
 * Ink reads stdin chunks as raw terminal input and parses ANSI control
 * sequences itself. Arrow keys are `ESC [ A/B/C/D` so we have to write
 * the literal escape (``) — ink-testing-library forwards the chunk
 * verbatim. Just writing `"[B"` makes Ink see a `[` keystroke, not down.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render } from "ink-testing-library";

vi.mock("../../auth-flow.js", () => ({
  startTuiLogin: vi.fn().mockResolvedValue(undefined),
  tuiLogout: vi.fn().mockResolvedValue(undefined),
  fetchAuthUser: vi.fn().mockResolvedValue(null),
  OAuthError: class OAuthError extends Error {},
}));

import * as authFlow from "../../auth-flow.js";
import { useTUIStore } from "../../state.js";
import { ModeSelector } from "./mode-selector.js";

// Arrow keys send ESC + `[A` / `[B` etc. We embed the ESC (0x1B) as a
// `` escape so the file stays printable ASCII. Without the leading
// ESC, Ink's input parser reads `[` and `B` as two literal keystrokes.
const ARROW_DOWN = "[B";
const ARROW_UP = "[A";
const ENTER = "\r";

/**
 * Yield to the event loop so Ink can flush the post-input render. Ink
 * batches under React 19 concurrent mode + has its own internal ANSI
 * parser that buffers across stdin chunks, so a single `setImmediate`
 * tick isn't always enough — wait one full timer tick to guarantee the
 * frame reflects the keystroke.
 */
const tick = () => new Promise<void>((resolve) => setTimeout(resolve, 20));

beforeEach(() => {
  vi.clearAllMocks();
  useTUIStore.setState({
    screen: "menu",
    // Seed an authed user by default so navigation tests don't hit the
    // post-Wave-9 auth gate (un-authed selection now triggers login flow).
    // Tests that specifically verify the gate or signed-out behaviour
    // override this with `useTUIStore.setState({ authUser: null })`.
    authUser: {
      email: "you@autousers.ai",
      teamName: "Acme",
      plan: "Free",
      freeRunsLeft: 12,
      freeRunsTotal: 30,
    },
    placeholderTarget: null,
  });
});

afterEach(() => {
  // ink-testing-library's render() handle gets cleaned up automatically
  // when the next test mounts a fresh tree, so no explicit teardown is
  // required here. Keep the hook as a placeholder for future state.
});

describe("ModeSelector", () => {
  it("renders all six menu items with labels and descriptions", () => {
    const { lastFrame } = render(<ModeSelector />);
    const frame = lastFrame() ?? "";
    expect(frame).toContain("Main menu");
    expect(frame).toContain("Create new evaluation");
    expect(frame).toContain("Browse evaluations");
    expect(frame).toContain("Manage autousers");
    expect(frame).toContain("Manage templates");
    expect(frame).toContain("Settings");
    expect(frame).toContain("Logout");
  });

  it("highlights the first item by default with a > caret", () => {
    const { lastFrame } = render(<ModeSelector />);
    const frame = lastFrame() ?? "";
    // The caret precedes the row's index character.
    expect(frame).toMatch(/>\s+1\s+Create new evaluation/);
  });

  it("moves selection down on the down arrow and back up on the up arrow", async () => {
    const { stdin, lastFrame } = render(<ModeSelector />);
    stdin.write(ARROW_DOWN);
    await tick();
    let frame = lastFrame() ?? "";
    expect(frame).toMatch(/>\s+2\s+Browse evaluations/);

    stdin.write(ARROW_UP);
    await tick();
    frame = lastFrame() ?? "";
    expect(frame).toMatch(/>\s+1\s+Create new evaluation/);
  });

  it("quick-selects item 1 (eval-creator) with digit input", async () => {
    const { stdin } = render(<ModeSelector />);
    stdin.write("1");
    await tick();
    const state = useTUIStore.getState();
    // Wave 4 routes menu item 1 to the real eval-creator screen, NOT
    // through the wave-3 placeholder anymore.
    expect(state.screen).toBe("eval-creator");
  });

  it("quick-selects item 2 (eval-history) with digit input", async () => {
    const { stdin } = render(<ModeSelector />);
    stdin.write("2");
    await tick();
    const state = useTUIStore.getState();
    // Wave 7 routes menu item 2 directly to the real eval-history screen
    // rather than through the wave-3 placeholder.
    expect(state.screen).toBe("eval-history");
  });

  it("quick-selects item 3 (autoraters-hub) with digit input", async () => {
    const { stdin } = render(<ModeSelector />);
    stdin.write("3");
    await tick();
    const state = useTUIStore.getState();
    // Wave 8 routes menu item 3 directly to the real autoraters-hub
    // screen rather than through the wave-3 placeholder.
    expect(state.screen).toBe("autoraters-hub");
  });

  it("quick-selects item 4 (templates-hub) with digit input", async () => {
    const { stdin } = render(<ModeSelector />);
    stdin.write("4");
    await tick();
    const state = useTUIStore.getState();
    // Wave 9 routes menu item 4 directly to the real templates-hub
    // screen rather than through the wave-3 placeholder.
    expect(state.screen).toBe("templates-hub");
  });

  it("quick-selects item 5 (settings) with digit input", async () => {
    const { stdin } = render(<ModeSelector />);
    stdin.write("5");
    await tick();
    const state = useTUIStore.getState();
    // Wave 9 routes menu item 5 directly to the real settings screen
    // rather than through the wave-3 placeholder.
    expect(state.screen).toBe("settings");
  });

  it("triggers logout when item 6 is selected via digit", async () => {
    const { stdin } = render(<ModeSelector />);
    stdin.write("6");
    await tick();
    expect(authFlow.tuiLogout).toHaveBeenCalledTimes(1);
    // Logout must NOT route the screen — the user stays on the menu so
    // they can immediately log back in or exit.
    expect(useTUIStore.getState().screen).toBe("menu");
  });

  it("triggers Enter on the currently highlighted row", async () => {
    const { stdin } = render(<ModeSelector />);
    // Move down once -> row 2 highlighted.
    stdin.write(ARROW_DOWN);
    await tick();
    stdin.write(ENTER);
    await tick();
    const state = useTUIStore.getState();
    // Wave 7: row 2 routes directly to the real eval-history screen.
    expect(state.screen).toBe("eval-history");
  });

  it("calls startTuiLogin on `l` when signed-out", async () => {
    useTUIStore.setState({ authUser: null });
    const { stdin } = render(<ModeSelector />);
    stdin.write("l");
    await tick();
    expect(authFlow.startTuiLogin).toHaveBeenCalledTimes(1);
    expect(authFlow.tuiLogout).not.toHaveBeenCalled();
  });

  it("calls tuiLogout on `l` when signed-in", async () => {
    useTUIStore.setState({
      authUser: {
        email: "you@autousers.ai",
        teamName: "Acme",
      },
    });
    const { stdin } = render(<ModeSelector />);
    stdin.write("l");
    await tick();
    expect(authFlow.tuiLogout).toHaveBeenCalledTimes(1);
    expect(authFlow.startTuiLogin).not.toHaveBeenCalled();
  });

  it("toggles the help legend on `?`", async () => {
    const { stdin, lastFrame } = render(<ModeSelector />);
    let frame = lastFrame() ?? "";
    expect(frame).not.toContain("Keybinds");

    stdin.write("?");
    await tick();
    frame = lastFrame() ?? "";
    expect(frame).toContain("Keybinds");
    expect(frame).toContain("navigate");
    expect(frame).toContain("login/logout");

    stdin.write("?");
    await tick();
    frame = lastFrame() ?? "";
    expect(frame).not.toContain("Keybinds");
  });
});
