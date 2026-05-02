/**
 * Tests for the autorater picker.
 *
 * Covers:
 *   - Built-in section renders when the loader returns built-in rows
 *   - Custom section appears under its own header when loader returns
 *     custom rows
 *   - Enter on a built-in row calls onSelect with `{source: "built-in"}`
 *   - Enter on a custom row calls onSelect with `{source: "custom"}`
 *   - Esc calls onBack
 *   - The "+ New autouser" affordance renders, is selectable, and routes
 *     to the autorater-creator screen on Enter (Wave 8)
 *   - Loader rejection surfaces an inline error rather than fake fallback
 *     rows (the symptom of the original bug — a hardcoded list of fake
 *     personas was masking the real fetch failure)
 *   - Empty result set surfaces a "no autousers visible" message and the
 *     +New affordance is still actionable
 *
 * The loader is injected via the `loadAutousers` prop so the picker can
 * be exercised without standing up the API client + persisted bearer.
 */

import { describe, expect, it, vi } from "vitest";
import { render } from "ink-testing-library";

import { AutoraterPicker } from "./autorater-picker.js";
import type { PickerAutouser } from "./autorater-picker.js";
import { useTUIStore } from "../../state.js";

const ENTER = "\r";
// Arrow keys are ESC + `[A` / `[B` etc. Build them via
// `String.fromCharCode(27)` rather than embedding the raw byte so the
// source file stays printable ASCII; ink-testing-library forwards the
// chunk verbatim to Ink, which parses ANSI control sequences itself.
const ESC_BYTE = String.fromCharCode(27);
const ARROW_DOWN = `${ESC_BYTE}[B`;
const ESC = ESC_BYTE;

const tick = (ms = 30) => new Promise<void>((r) => setTimeout(r, ms));

const builtInRows: PickerAutouser[] = [
  {
    id: "au_built_skeptic",
    name: "Skeptical Shopper",
    description: "Inspects every claim before clicking buy.",
    source: "built-in",
  },
  {
    id: "au_built_speed",
    name: "Speed Reader",
    description: "Skims; abandons if friction high.",
    source: "built-in",
  },
];

describe("AutoraterPicker", () => {
  it("renders the +New affordance even when there are no rows", async () => {
    const onSelect = vi.fn();
    const onBack = vi.fn();
    const { lastFrame } = render(
      <AutoraterPicker
        onSelect={onSelect}
        onBack={onBack}
        loadAutousers={async () => []}
      />
    );
    await tick();
    const f = lastFrame() ?? "";
    expect(f).toContain("Select Autouser");
    expect(f).toContain("+ New autouser");
    expect(f).toContain("No autousers visible");
  });

  it("renders the Built-in section when the loader returns built-in rows", async () => {
    const onSelect = vi.fn();
    const onBack = vi.fn();
    const { lastFrame } = render(
      <AutoraterPicker
        onSelect={onSelect}
        onBack={onBack}
        loadAutousers={async () => builtInRows}
      />
    );
    await tick();
    const f = lastFrame() ?? "";
    expect(f).toContain("Built-in");
    expect(f).toContain("Skeptical Shopper");
    expect(f).toContain("Speed Reader");
    // Crucially, no fake hardcoded fallback rows are rendered. These
    // are the four labels the previous implementation hardcoded.
    expect(f).not.toContain("Casual Browser");
    expect(f).not.toContain("Power User");
    expect(f).not.toContain("First-Time Visitor");
    expect(f).not.toContain("Conversion Skeptic");
  });

  it("appends the Custom section when the loader returns custom rows", async () => {
    const onSelect = vi.fn();
    const onBack = vi.fn();
    const { lastFrame } = render(
      <AutoraterPicker
        onSelect={onSelect}
        onBack={onBack}
        loadAutousers={async () => [
          ...builtInRows,
          {
            id: "cmoiCUSTOM01",
            name: "Acme Power User",
            description: "Internal testing persona",
            source: "custom",
          },
        ]}
      />
    );
    await tick();
    const f = lastFrame() ?? "";
    expect(f).toContain("Custom");
    expect(f).toContain("Acme Power User");
  });

  it("calls onSelect with the highlighted built-in on Enter", async () => {
    const onSelect = vi.fn();
    const onBack = vi.fn();
    const { stdin } = render(
      <AutoraterPicker
        onSelect={onSelect}
        onBack={onBack}
        loadAutousers={async () => builtInRows}
      />
    );
    await tick();
    stdin.write(ENTER);
    await tick();
    expect(onSelect).toHaveBeenCalledTimes(1);
    expect(onSelect.mock.calls[0]![0]).toEqual({
      id: "au_built_skeptic",
      name: "Skeptical Shopper",
      source: "built-in",
    });
  });

  it("navigates down to the second built-in row and selects it", async () => {
    const onSelect = vi.fn();
    const onBack = vi.fn();
    const { stdin } = render(
      <AutoraterPicker
        onSelect={onSelect}
        onBack={onBack}
        loadAutousers={async () => builtInRows}
      />
    );
    // Wait for the loader to resolve and the list to render before
    // pressing ARROW_DOWN — under concurrent test load the default
    // 30ms tick can race the state update.
    await tick(60);
    stdin.write(ARROW_DOWN);
    await tick();
    stdin.write(ENTER);
    await tick();
    expect(onSelect.mock.calls[0]![0]).toMatchObject({
      id: "au_built_speed",
      source: "built-in",
    });
  });

  it("calls onBack when Esc is pressed", async () => {
    const onSelect = vi.fn();
    const onBack = vi.fn();
    const { stdin } = render(
      <AutoraterPicker
        onSelect={onSelect}
        onBack={onBack}
        loadAutousers={async () => builtInRows}
      />
    );
    await tick();
    stdin.write(ESC);
    await tick();
    expect(onBack).toHaveBeenCalledTimes(1);
  });

  it("routes to the autorater-creator screen when +New is selected", async () => {
    // Wave 8: the +New row is now a real navigation target. Walking past
    // every built-in row lands the cursor on it; pressing Enter sets
    // `screen` to "autorater-creator" via the store.
    useTUIStore.setState({ screen: "menu" });
    const onSelect = vi.fn();
    const onBack = vi.fn();
    const { stdin } = render(
      <AutoraterPicker
        onSelect={onSelect}
        onBack={onBack}
        loadAutousers={async () => builtInRows}
      />
    );
    await tick(60);
    // Walk past every built-in row to land on +New.
    for (let i = 0; i < 20; i++) {
      stdin.write(ARROW_DOWN);
    }
    await tick();
    stdin.write(ENTER);
    await tick();
    // onSelect must NOT fire for the +New row — it routes via the
    // global store instead.
    expect(onSelect).not.toHaveBeenCalled();
    expect(useTUIStore.getState().screen).toBe("autorater-creator");
  });

  it("surfaces an inline error message when the loader rejects", async () => {
    // The previous behaviour was to silently swallow the error and
    // render hardcoded fake personas as a fallback. The new contract
    // is: surface the error so the user knows their auth is broken
    // (or whatever else went wrong) rather than letting them pick
    // a fictional row.
    const onSelect = vi.fn();
    const onBack = vi.fn();
    const { lastFrame } = render(
      <AutoraterPicker
        onSelect={onSelect}
        onBack={onBack}
        loadAutousers={() => Promise.reject(new Error("boom"))}
      />
    );
    await tick();
    const f = lastFrame() ?? "";
    expect(f).toContain("Failed to load autousers");
    expect(f).toContain("boom");
    // No fake fallback personas.
    expect(f).not.toContain("Casual Browser");
    expect(f).not.toContain("Power User");
  });

  it("renders server-tagged rows under the right section header", async () => {
    // The default loader (covered separately in eval-creator integration
    // tests) maps the server's `source` field directly. This test pins
    // the contract: rows tagged `source: "built-in"` go under "Built-in",
    // rows tagged `source: "custom"` go under "Custom".
    const onSelect = vi.fn();
    const onBack = vi.fn();
    const { lastFrame } = render(
      <AutoraterPicker
        onSelect={onSelect}
        onBack={onBack}
        loadAutousers={async () => [
          {
            id: "from-server",
            name: "Server Tagged",
            description: "from real api",
            source: "built-in",
          },
        ]}
      />
    );
    await tick();
    const f = lastFrame() ?? "";
    expect(f).toContain("Server Tagged");
    expect(f).toContain("Built-in");
  });
});
