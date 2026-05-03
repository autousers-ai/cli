/**
 * Tests for the Wave 8 autorater-calibration screen.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render } from "ink-testing-library";

import { AutoraterCalibration } from "./autorater-calibration.js";
import { useTUIStore } from "../../state.js";

const ESC = String.fromCharCode(27);
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

const calibrationStatus = {
  data: {
    status: "calibrating",
    kappa: 0.62,
    agreement: 0.81,
    sampleSize: 24,
    activeRubricId: "rb_v1",
  },
};

const stubClient = (status = calibrationStatus) => ({
  get: vi.fn().mockResolvedValue(status),
  post: vi.fn().mockResolvedValue({
    data: { message: "Calibration started", kappa: 0.7 },
  }),
});

beforeEach(() => {
  useTUIStore.setState({
    screen: "autorater-calibration",
    calibratingAutouserId: "au_test",
    authUser: null,
    placeholderTarget: null,
    toast: null,
  });
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("AutoraterCalibration", () => {
  it("renders calibration status once the API responds", async () => {
    const client = stubClient();
    const { lastFrame } = render(
      <AutoraterCalibration createClient={async () => client} />
    );
    await tick(60);
    const f = lastFrame() ?? "";
    expect(client.get).toHaveBeenCalledWith(
      "/api/v1/autousers/au_test/calibration"
    );
    expect(f).toContain("calibrating");
    expect(f).toContain("0.620"); // kappa formatted
  });

  it("s triggers the calibration start endpoint", async () => {
    const client = stubClient();
    const { stdin, lastFrame } = render(
      <AutoraterCalibration createClient={async () => client} />
    );
    await tick(60);
    stdin.write("s");
    await waitForCall(client.post);
    expect(client.post).toHaveBeenCalledWith(
      "/api/v1/autousers/au_test/calibration/start",
      {}
    );
    expect(lastFrame()).toContain("Calibration started");
  });

  it("f triggers the freeze endpoint", async () => {
    const client = stubClient();
    const { stdin } = render(
      <AutoraterCalibration createClient={async () => client} />
    );
    await tick(60);
    stdin.write("f");
    await tick(60);
    expect(client.post).toHaveBeenCalledWith(
      "/api/v1/autousers/au_test/calibration/freeze",
      {}
    );
  });

  it("o triggers the optimize endpoint", async () => {
    const client = stubClient();
    const { stdin } = render(
      <AutoraterCalibration createClient={async () => client} />
    );
    await tick(60);
    stdin.write("o");
    await tick(60);
    expect(client.post).toHaveBeenCalledWith(
      "/api/v1/autousers/au_test/calibration/optimize",
      {}
    );
  });

  it("Enter on the highlighted action runs that action", async () => {
    const client = stubClient();
    const { stdin } = render(
      <AutoraterCalibration createClient={async () => client} />
    );
    await tick(60);
    stdin.write(ENTER);
    await tick(60);
    expect(client.post).toHaveBeenCalledWith(
      "/api/v1/autousers/au_test/calibration/start",
      {}
    );
  });

  it("Esc returns to the hub", async () => {
    const client = stubClient();
    const { stdin } = render(
      <AutoraterCalibration createClient={async () => client} />
    );
    await tick(60);
    stdin.write(ESC);
    await tick();
    expect(useTUIStore.getState().screen).toBe("autoraters-hub");
  });
});
