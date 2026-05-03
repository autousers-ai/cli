/**
 * Tests for the generic wizard chrome.
 *
 * The wizard is a pure layout primitive — no state, no input handling —
 * so the tests focus on visual semantics: which step is active, which
 * are complete, which are pending, and that the preview line shows up
 * for completed steps. Forward / back navigation and validation are
 * verified at the screen-test level (eval-creator.test.tsx).
 */
import { describe, expect, it, vi } from "vitest";
import { render } from "ink-testing-library";
import { Text } from "@jrichman/ink";

// The wizard renders its full sidebar (with [x]/[>]/[ ] markers, preview
// lines, and the title row) only on wide terminals (>= 100 cols). vitest
// runs in jsdom by default with no `process.stdout.columns` set, so we
// stub `isWideTerminal()` to return true for the test harness.
vi.mock("../../tty.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../tty.js")>();
  return {
    ...actual,
    isWideTerminal: () => true,
  };
});

import { Wizard, type WizardStep } from "./wizard.js";

const STEPS: WizardStep[] = [
  { key: "type", label: "Type", preview: "SSE" },
  { key: "urls", label: "URLs", preview: "1 URL" },
  { key: "review", label: "Review" },
];

describe("Wizard", () => {
  it("renders all step labels", () => {
    const { lastFrame } = render(
      <Wizard steps={STEPS} activeKey="urls" title="Create Evaluation">
        <></>
      </Wizard>
    );
    const f = lastFrame() ?? "";
    expect(f).toContain("Type");
    expect(f).toContain("URLs");
    expect(f).toContain("Review");
  });

  it("marks the active step with [>]", () => {
    const { lastFrame } = render(
      <Wizard steps={STEPS} activeKey="urls">
        <></>
      </Wizard>
    );
    const f = lastFrame() ?? "";
    // A completed step (Type) renders [x]; the active step (URLs) [>];
    // the pending step (Review) [ ].
    expect(f).toMatch(/\[x\]\s+Type/);
    expect(f).toMatch(/\[>\]\s+URLs/);
    expect(f).toMatch(/\[\s\]\s+Review/);
  });

  it("renders the preview line under completed steps only", () => {
    const { lastFrame } = render(
      <Wizard steps={STEPS} activeKey="review">
        <></>
      </Wizard>
    );
    const f = lastFrame() ?? "";
    // Type and URLs are now both complete and have previews → both lines visible.
    expect(f).toContain("SSE");
    expect(f).toContain("1 URL");
  });

  it("does not render preview lines under the active or pending steps", () => {
    const { lastFrame } = render(
      <Wizard steps={STEPS} activeKey="type">
        <></>
      </Wizard>
    );
    const f = lastFrame() ?? "";
    // No step is complete yet → SSE/1 URL preview text should NOT show.
    expect(f).not.toContain("SSE");
    expect(f).not.toContain("1 URL");
  });

  it("renders the title row when provided", () => {
    const { lastFrame } = render(
      <Wizard steps={STEPS} activeKey="type" title="Create Evaluation">
        <></>
      </Wizard>
    );
    expect(lastFrame() ?? "").toContain("Create Evaluation");
  });

  it("renders the body content the host passes via children", () => {
    const { lastFrame } = render(
      <Wizard steps={STEPS} activeKey="type">
        <Text>BODY-CONTENT</Text>
      </Wizard>
    );
    expect(lastFrame() ?? "").toContain("BODY-CONTENT");
  });
});
