import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { render } from "ink-testing-library";

import { useTUIStore } from "../state.js";
import { Header } from "./header.js";
import { CLI_VERSION } from "../../client.js";

const ORIGINAL_ENV = { ...process.env };

beforeEach(() => {
  useTUIStore.setState({
    screen: "menu",
    authUser: null,
    placeholderTarget: null,
  });
  // Force the inline-image-unsupported fallback path so tests are
  // deterministic regardless of which terminal vitest itself was
  // launched from.
  delete process.env.TERM_PROGRAM;
  delete process.env.LC_TERMINAL;
  delete process.env.KITTY_WINDOW_ID;
});

afterEach(() => {
  process.env = { ...ORIGINAL_ENV };
});

describe("Header", () => {
  it("renders the autousers wordmark and version", () => {
    const { lastFrame } = render(<Header />);
    const frame = lastFrame() ?? "";
    // Wordmark is the ANSI Shadow rendering of "AUTOUSERS"; version
    // shows as plain `CLI vX.Y.Z` on the line below.
    expect(frame).toContain("█████╗");
    expect(frame).toContain(`CLI v${CLI_VERSION}`);
  });

  it("renders the ANSI Shadow AUTOUSERS wordmark", () => {
    const { lastFrame } = render(<Header />);
    const frame = lastFrame() ?? "";
    // The wordmark uses block characters (█) and the ANSI Shadow font's
    // distinctive shadowed corners (╗ ╝ ╔ ╚). Assert on rows that uniquely
    // identify the rendering.
    expect(frame).toContain("█████╗");
    expect(frame).toContain("╚═╝");
  });

  it("falls back to a Not-signed-in line when authUser is null", () => {
    const { lastFrame } = render(<Header />);
    const frame = lastFrame() ?? "";
    expect(frame).toContain("Not signed in");
    expect(frame).toContain("/login");
  });

  it("renders the signed-in line, plan/quota line, and shortcuts when authed", () => {
    useTUIStore.getState().setAuthUser({
      email: "you@autousers.ai",
      teamName: "Acme",
      plan: "Free",
      freeRunsLeft: 12,
      freeRunsTotal: 30,
    });

    const { lastFrame } = render(<Header />);
    const frame = lastFrame() ?? "";

    expect(frame).toContain("Signed in as");
    expect(frame).toContain("you@autousers.ai");
    expect(frame).toContain("Acme");
    expect(frame).toContain("/logout");
    expect(frame).toContain("Plan: Free");
    expect(frame).toContain("12/30 free runs left");
    expect(frame).toContain("/upgrade");
  });

  it("renders the current working directory", () => {
    const { lastFrame } = render(<Header />);
    const frame = lastFrame() ?? "";
    expect(frame).toContain(process.cwd());
  });
});
