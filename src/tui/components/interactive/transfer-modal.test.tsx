/**
 * Tests for the Wave 7 transfer-ownership modal.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render } from "ink-testing-library";

import { TransferModal } from "./transfer-modal.js";

const ENTER = "\r";
const tick = (ms = 30) => new Promise<void>((r) => setTimeout(r, ms));

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("<TransferModal>", () => {
  it("renders the warning copy and target field", () => {
    const { lastFrame } = render(
      <TransferModal
        evaluationId="e1"
        evaluationName="Acme"
        onClose={() => {}}
        createClient={async () => ({ post: vi.fn() })}
      />
    );
    const frame = lastFrame() ?? "";
    expect(frame).toContain("Transfer ownership");
    expect(frame).toContain("hard to reverse");
    expect(frame).toContain("Target:");
  });

  it("POSTs /transfer with the typed slug and resolves success", async () => {
    const post = vi.fn().mockResolvedValue({
      data: { id: "e1", ownerTeamId: "team_123" },
    });
    const onClose = vi.fn();
    const { stdin } = render(
      <TransferModal
        evaluationId="e1"
        onClose={onClose}
        createClient={async () => ({ post })}
      />
    );
    await tick();
    stdin.write("acme-team");
    await tick();
    stdin.write(ENTER);
    await tick(50);
    expect(post).toHaveBeenCalledTimes(1);
    expect(post.mock.calls[0]![0]).toBe("/api/v1/evaluations/e1/transfer");
    expect(post.mock.calls[0]![1]).toEqual({ to: "acme-team" });
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(onClose.mock.calls[0]![0].kind).toBe("success");
  });

  it("rejects an empty target", async () => {
    const post = vi.fn();
    const onClose = vi.fn();
    const { stdin, lastFrame } = render(
      <TransferModal
        evaluationId="e1"
        onClose={onClose}
        createClient={async () => ({ post })}
      />
    );
    await tick();
    stdin.write(ENTER);
    await tick();
    expect(post).not.toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();
    expect(lastFrame()).toContain("Team slug or id is required");
  });
});
