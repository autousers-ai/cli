/**
 * Tests for the Wave 7 share modal.
 *
 * Coverage:
 *   1. Title renders with the eval name.
 *   2. Tab moves focus into the role row, ←/→ cycles the role.
 *   3. Submitting calls `POST /api/v1/evaluations/:id/shares` with the
 *      typed email + selected role and resolves with `{ kind: "success" }`.
 *   4. Esc resolves with `{ kind: "cancel" }`.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render } from "ink-testing-library";

import { ShareModal } from "./share-modal.js";

const ESC = String.fromCharCode(27);
const ARROW_RIGHT = `${ESC}[C`;
const TAB = "\t";
const ENTER = "\r";
const tick = (ms = 30) => new Promise<void>((r) => setTimeout(r, ms));

// Polls a vi.fn until it has been called `count` times, or until
// `timeoutMs` elapses. Replaces fixed `await tick(...)` waits that
// race the post-keystroke async chain (createClient + post → state
// update → render) under concurrent vitest load.
async function waitForCall(
  fn: { mock: { calls: unknown[] } },
  count = 1,
  timeoutMs = 1000
) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (fn.mock.calls.length >= count) return;
    await new Promise((r) => setTimeout(r, 10));
  }
  if (fn.mock.calls.length < count) {
    throw new Error(
      `waitForCall: expected ${count} call(s), got ${fn.mock.calls.length} within ${timeoutMs}ms`
    );
  }
}

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("<ShareModal>", () => {
  it("renders the modal title with the evaluation name", () => {
    const { lastFrame } = render(
      <ShareModal
        evaluationId="e1"
        evaluationName="Acme landing"
        onClose={() => {}}
        createClient={async () => ({ post: vi.fn() })}
      />
    );
    const frame = lastFrame() ?? "";
    expect(frame).toContain("Share evaluation");
    expect(frame).toContain("Acme landing");
    expect(frame).toContain("Email:");
    expect(frame).toContain("Role:");
    expect(frame).toContain("viewer");
  });

  it("submits POST /shares with the typed email and resolves success", async () => {
    const post = vi.fn().mockResolvedValue({
      data: { id: "s1", email: "user@example.com", role: "viewer" },
    });
    const onClose = vi.fn();
    const { stdin } = render(
      <ShareModal
        evaluationId="e1"
        evaluationName="Acme"
        onClose={onClose}
        createClient={async () => ({ post })}
      />
    );
    await tick();
    // Type email then submit
    stdin.write("user@example.com");
    await tick();
    stdin.write(ENTER);
    await tick();
    // After the email submits we move into role row; press Enter again
    // to actually submit the modal.
    stdin.write(ENTER);
    await waitForCall(post);
    expect(post).toHaveBeenCalledTimes(1);
    expect(post.mock.calls[0]![0]).toBe("/api/v1/evaluations/e1/shares");
    expect(post.mock.calls[0]![1]).toEqual({
      email: "user@example.com",
      role: "viewer",
    });
    await waitForCall(onClose);
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(onClose.mock.calls[0]![0].kind).toBe("success");
  });

  it("Esc resolves cancel without calling POST", async () => {
    const post = vi.fn();
    const onClose = vi.fn();
    const { stdin } = render(
      <ShareModal
        evaluationId="e1"
        onClose={onClose}
        createClient={async () => ({ post })}
      />
    );
    await tick();
    // Tab out of email so the keystroke handler is active.
    stdin.write(TAB);
    await tick();
    stdin.write(ESC);
    await tick();
    expect(post).not.toHaveBeenCalled();
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(onClose.mock.calls[0]![0].kind).toBe("cancel");
  });

  it("← / → on the role row cycles through viewer / editor / owner", async () => {
    const post = vi.fn().mockResolvedValue({});
    const onClose = vi.fn();
    const { stdin } = render(
      <ShareModal
        evaluationId="e1"
        onClose={onClose}
        createClient={async () => ({ post })}
      />
    );
    await tick();
    // Type email and submit to move to the role row.
    stdin.write("a@b.com");
    await tick();
    stdin.write(ENTER);
    await tick();
    // Right arrow -> editor
    stdin.write(ARROW_RIGHT);
    await tick();
    // Right arrow -> owner
    stdin.write(ARROW_RIGHT);
    await tick();
    // Submit
    stdin.write(ENTER);
    await waitForCall(post);
    expect(post).toHaveBeenCalledTimes(1);
    expect(post.mock.calls[0]![1]).toEqual({
      email: "a@b.com",
      role: "owner",
    });
  });
});
