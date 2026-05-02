/**
 * Tests for the Wave 7 invite modal.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render } from "ink-testing-library";

import { InviteModal } from "./invite-modal.js";

const ENTER = "\r";
const tick = (ms = 30) => new Promise<void>((r) => setTimeout(r, ms));

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("<InviteModal>", () => {
  it("renders the email input", () => {
    const { lastFrame } = render(
      <InviteModal
        evaluationId="e1"
        evaluationName="Acme"
        onClose={() => {}}
        createClient={async () => ({ post: vi.fn() })}
      />
    );
    const frame = lastFrame() ?? "";
    expect(frame).toContain("Invite to evaluation");
    expect(frame).toContain("Acme");
    expect(frame).toContain("Email:");
  });

  it("POSTs /invites with the typed email and resolves success", async () => {
    const post = vi.fn().mockResolvedValue({
      data: { id: "inv1", email: "new@example.com" },
    });
    const onClose = vi.fn();
    const { stdin } = render(
      <InviteModal
        evaluationId="e1"
        onClose={onClose}
        createClient={async () => ({ post })}
      />
    );
    await tick();
    stdin.write("new@example.com");
    await tick();
    stdin.write(ENTER);
    await tick(50);
    expect(post).toHaveBeenCalledTimes(1);
    expect(post.mock.calls[0]![0]).toBe("/api/v1/evaluations/e1/invites");
    expect(post.mock.calls[0]![1]).toEqual({ email: "new@example.com" });
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(onClose.mock.calls[0]![0].kind).toBe("success");
  });

  it("rejects an email without an @ sign with an error message", async () => {
    const post = vi.fn();
    const onClose = vi.fn();
    const { stdin, lastFrame } = render(
      <InviteModal
        evaluationId="e1"
        onClose={onClose}
        createClient={async () => ({ post })}
      />
    );
    await tick();
    stdin.write("invalid");
    await tick();
    stdin.write(ENTER);
    await tick();
    expect(post).not.toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();
    expect(lastFrame()).toContain("Enter a valid email");
  });
});
