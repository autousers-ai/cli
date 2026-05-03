import { describe, it, expect, vi, beforeEach } from "vitest";

import { TUIEventBus, type TUIEvent } from "./events.js";

// Wave 5 replaced the placeholder `noop` variant with the full event
// surface. We pick `run:progress` for the bus tests because it has the
// simplest payload (three numbers, no nested objects) and exercises
// type-narrowing through `Extract<TUIEvent, { type: T }>` end-to-end.
const progressEvent: TUIEvent = {
  type: "run:progress",
  completed: 0,
  total: 1,
  errors: 0,
};

describe("TUIEventBus", () => {
  let bus: TUIEventBus;

  beforeEach(() => {
    bus = new TUIEventBus();
  });

  it("on() registers a handler and emit() invokes it", () => {
    const handler = vi.fn();
    bus.on("run:progress", handler);
    bus.emit(progressEvent);
    expect(handler).toHaveBeenCalledOnce();
    expect(handler).toHaveBeenCalledWith(progressEvent);
  });

  it("on() returns an unsubscribe function that stops delivery", () => {
    const handler = vi.fn();
    const unsubscribe = bus.on("run:progress", handler);

    bus.emit(progressEvent);
    expect(handler).toHaveBeenCalledOnce();

    unsubscribe();
    bus.emit(progressEvent);
    expect(handler).toHaveBeenCalledOnce();
  });

  it("multiple handlers on the same event type all fire", () => {
    const a = vi.fn();
    const b = vi.fn();
    const c = vi.fn();

    bus.on("run:progress", a);
    bus.on("run:progress", b);
    bus.on("run:progress", c);

    bus.emit(progressEvent);

    expect(a).toHaveBeenCalledOnce();
    expect(b).toHaveBeenCalledOnce();
    expect(c).toHaveBeenCalledOnce();
  });

  it("removeAllListeners() clears every subscription", () => {
    const handler = vi.fn();
    bus.on("run:progress", handler);

    bus.removeAllListeners();
    bus.emit(progressEvent);

    expect(handler).not.toHaveBeenCalled();
  });

  it("emit() with no registered handlers does not throw", () => {
    expect(() => bus.emit(progressEvent)).not.toThrow();
  });

  it("delivers different event types to their respective handlers", () => {
    const onStart = vi.fn();
    const onProgress = vi.fn();
    bus.on("session:start", onStart);
    bus.on("run:progress", onProgress);

    bus.emit({
      type: "session:start",
      sessionId: "r1",
      autouser: "built-in:casual-browser",
      autouserType: "builtin",
      timestamp: "2026-05-02T00:00:00Z",
    });
    bus.emit(progressEvent);

    expect(onStart).toHaveBeenCalledOnce();
    expect(onProgress).toHaveBeenCalledOnce();
  });
});
