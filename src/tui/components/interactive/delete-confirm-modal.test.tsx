/**
 * Tests for the Wave 7 delete-confirm modal.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render } from "ink-testing-library";

import { DeleteConfirmModal } from "./delete-confirm-modal.js";

const ESC = String.fromCharCode(27);
const tick = (ms = 30) => new Promise<void>((r) => setTimeout(r, ms));

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("<DeleteConfirmModal>", () => {
  it("renders the destructive warning with the eval name", () => {
    const { lastFrame } = render(
      <DeleteConfirmModal
        evaluationId="e1"
        evaluationName="Acme"
        onClose={() => {}}
        createClient={async () => ({ delete: vi.fn() })}
      />
    );
    const frame = lastFrame() ?? "";
    expect(frame).toContain("Delete evaluation");
    expect(frame).toContain("Acme");
    expect(frame).toContain("cannot be undone");
  });

  it("`y` triggers DELETE and resolves success", async () => {
    const del = vi.fn().mockResolvedValue(undefined);
    const onClose = vi.fn();
    const { stdin } = render(
      <DeleteConfirmModal
        evaluationId="e1"
        evaluationName="Acme"
        onClose={onClose}
        createClient={async () => ({ delete: del })}
      />
    );
    await tick();
    stdin.write("y");
    await tick(50);
    expect(del).toHaveBeenCalledTimes(1);
    expect(del.mock.calls[0]![0]).toBe("/api/v1/evaluations/e1");
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(onClose.mock.calls[0]![0].kind).toBe("success");
  });

  it("`n` cancels without calling DELETE", async () => {
    const del = vi.fn();
    const onClose = vi.fn();
    const { stdin } = render(
      <DeleteConfirmModal
        evaluationId="e1"
        onClose={onClose}
        createClient={async () => ({ delete: del })}
      />
    );
    await tick();
    stdin.write("n");
    await tick();
    expect(del).not.toHaveBeenCalled();
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(onClose.mock.calls[0]![0].kind).toBe("cancel");
  });

  it("Esc cancels", async () => {
    const del = vi.fn();
    const onClose = vi.fn();
    const { stdin } = render(
      <DeleteConfirmModal
        evaluationId="e1"
        onClose={onClose}
        createClient={async () => ({ delete: del })}
      />
    );
    await tick();
    stdin.write(ESC);
    await tick();
    expect(del).not.toHaveBeenCalled();
    expect(onClose.mock.calls[0]![0].kind).toBe("cancel");
  });
});
