import { describe, it, expect, beforeEach } from "vitest";

import { useTUIStore, type SessionState } from "./state.js";

beforeEach(() => {
  // Reset to factory defaults — Wave 5 added several dashboard fields,
  // so we use the store's own `resetDashboard` plus the screen/auth
  // defaults to keep individual cases isolated.
  useTUIStore.setState({
    screen: "menu",
    authUser: null,
    placeholderTarget: null,
    toast: null,
    commandPaletteOpen: false,
    commandPaletteValue: "",
  });
  useTUIStore.getState().resetDashboard();
});

describe("useTUIStore", () => {
  describe("initial state", () => {
    it("defaults to the menu screen with no auth user", () => {
      const state = useTUIStore.getState();
      expect(state.screen).toBe("menu");
      expect(state.authUser).toBeNull();
      expect(state.placeholderTarget).toBeNull();
      expect(state.toast).toBeNull();
    });

    it("history fields default to empty filters and created-desc sort", () => {
      const state = useTUIStore.getState();
      expect(state.selectedEvalId).toBeNull();
      expect(state.historyQuery).toBe("");
      expect(state.historyFilters).toEqual({
        status: null,
        type: null,
        range: "all",
        owner: null,
      });
      expect(state.historySort).toBe("created-desc");
    });

    it("dashboard fields default to empty / zero", () => {
      const state = useTUIStore.getState();
      expect(state.evaluationId).toBeNull();
      expect(state.sessions.size).toBe(0);
      expect(state.progress).toEqual({ completed: 0, total: 0, errors: 0 });
      expect(state.cost).toEqual({
        inputTokens: 0,
        outputTokens: 0,
        totalCost: 0,
      });
      expect(state.runStartedAt).toBeNull();
      expect(state.drillSessionId).toBeNull();
      expect(state.runComplete).toBe(false);
    });
  });

  describe("setScreen", () => {
    it("updates the active screen", () => {
      useTUIStore.getState().setScreen("welcome");
      expect(useTUIStore.getState().screen).toBe("welcome");

      useTUIStore.getState().setScreen("placeholder");
      expect(useTUIStore.getState().screen).toBe("placeholder");

      useTUIStore.getState().setScreen("loading-auth");
      expect(useTUIStore.getState().screen).toBe("loading-auth");

      useTUIStore.getState().setScreen("eval-creator");
      expect(useTUIStore.getState().screen).toBe("eval-creator");

      // Wave 5: dashboard + live-session
      useTUIStore.getState().setScreen("dashboard");
      expect(useTUIStore.getState().screen).toBe("dashboard");

      useTUIStore.getState().setScreen("live-session");
      expect(useTUIStore.getState().screen).toBe("live-session");

      // Wave 6: results
      useTUIStore.getState().setScreen("results");
      expect(useTUIStore.getState().screen).toBe("results");

      // Wave 7: eval-history + eval-results-by-id
      useTUIStore.getState().setScreen("eval-history");
      expect(useTUIStore.getState().screen).toBe("eval-history");

      useTUIStore.getState().setScreen("eval-results-by-id");
      expect(useTUIStore.getState().screen).toBe("eval-results-by-id");

      // Wave 8: autouser hub / creator / calibration
      useTUIStore.getState().setScreen("autoraters-hub");
      expect(useTUIStore.getState().screen).toBe("autoraters-hub");

      useTUIStore.getState().setScreen("autorater-creator");
      expect(useTUIStore.getState().screen).toBe("autorater-creator");

      useTUIStore.getState().setScreen("autorater-calibration");
      expect(useTUIStore.getState().screen).toBe("autorater-calibration");
    });
  });

  describe("autouser hub state (Wave 8)", () => {
    it("setEditingAutouserId stores the id when editing", () => {
      useTUIStore.getState().setEditingAutouserId("au_abc");
      expect(useTUIStore.getState().editingAutouserId).toBe("au_abc");
      useTUIStore.getState().setEditingAutouserId(null);
      expect(useTUIStore.getState().editingAutouserId).toBeNull();
    });

    it("setCalibratingAutouserId stores the id for the calibration wizard", () => {
      useTUIStore.getState().setCalibratingAutouserId("au_xyz");
      expect(useTUIStore.getState().calibratingAutouserId).toBe("au_xyz");
      useTUIStore.getState().setCalibratingAutouserId(null);
      expect(useTUIStore.getState().calibratingAutouserId).toBeNull();
    });
  });

  describe("history state (Wave 7)", () => {
    it("setSelectedEvalId stores the id selected from the list", () => {
      useTUIStore.getState().setSelectedEvalId("eval_xyz");
      expect(useTUIStore.getState().selectedEvalId).toBe("eval_xyz");
      useTUIStore.getState().setSelectedEvalId(null);
      expect(useTUIStore.getState().selectedEvalId).toBeNull();
    });

    it("setHistoryQuery / setHistoryFilters / setHistorySort mutate", () => {
      useTUIStore.getState().setHistoryQuery("acme");
      expect(useTUIStore.getState().historyQuery).toBe("acme");

      useTUIStore.getState().setHistoryFilters({
        status: "Ended",
        type: "SSE",
        range: "30d",
        owner: "me",
      });
      expect(useTUIStore.getState().historyFilters).toEqual({
        status: "Ended",
        type: "SSE",
        range: "30d",
        owner: "me",
      });

      useTUIStore.getState().setHistorySort("name");
      expect(useTUIStore.getState().historySort).toBe("name");
    });
  });

  describe("setAuthUser", () => {
    it("stores the resolved auth user", () => {
      useTUIStore.getState().setAuthUser({
        email: "you@autousers.ai",
        teamName: "Acme",
        plan: "Free",
        freeRunsLeft: 12,
        freeRunsTotal: 30,
      });

      const state = useTUIStore.getState();
      expect(state.authUser).toEqual({
        email: "you@autousers.ai",
        teamName: "Acme",
        plan: "Free",
        freeRunsLeft: 12,
        freeRunsTotal: 30,
      });
    });

    it("accepts null to represent the signed-out state", () => {
      useTUIStore.getState().setAuthUser({ email: "you@autousers.ai" });
      expect(useTUIStore.getState().authUser).not.toBeNull();

      useTUIStore.getState().setAuthUser(null);
      expect(useTUIStore.getState().authUser).toBeNull();
    });
  });

  describe("setPlaceholderTarget", () => {
    it("stores the placeholder routing target", () => {
      // Wave 9 emptied the active PlaceholderTarget set — every menu
      // destination now has a real screen. The store still accepts
      // any of the literal members of the union; the only inhabitant
      // post-Wave-9 is the inert sentinel `"never"`. Future waves can
      // add new placeholder targets without changing this test.
      useTUIStore.getState().setPlaceholderTarget("never");
      expect(useTUIStore.getState().placeholderTarget).toBe("never");
    });

    it("accepts null when leaving placeholder routing", () => {
      useTUIStore.getState().setPlaceholderTarget("never");
      expect(useTUIStore.getState().placeholderTarget).not.toBeNull();

      useTUIStore.getState().setPlaceholderTarget(null);
      expect(useTUIStore.getState().placeholderTarget).toBeNull();
    });
  });

  describe("templates / settings / teams (Wave 9)", () => {
    it("setScreen handles the four new Wave-9 screens", () => {
      useTUIStore.getState().setScreen("templates-hub");
      expect(useTUIStore.getState().screen).toBe("templates-hub");

      useTUIStore.getState().setScreen("template-creator");
      expect(useTUIStore.getState().screen).toBe("template-creator");

      useTUIStore.getState().setScreen("settings");
      expect(useTUIStore.getState().screen).toBe("settings");

      useTUIStore.getState().setScreen("teams-section");
      expect(useTUIStore.getState().screen).toBe("teams-section");
    });

    it("setEditingTemplateId stores the id when editing", () => {
      useTUIStore.getState().setEditingTemplateId("dim_abc");
      expect(useTUIStore.getState().editingTemplateId).toBe("dim_abc");
      useTUIStore.getState().setEditingTemplateId(null);
      expect(useTUIStore.getState().editingTemplateId).toBeNull();
    });

    it("setActiveTeamSlug stores / clears the active team slug", () => {
      useTUIStore.getState().setActiveTeamSlug("acme");
      expect(useTUIStore.getState().activeTeamSlug).toBe("acme");
      useTUIStore.getState().setActiveTeamSlug(null);
      expect(useTUIStore.getState().activeTeamSlug).toBeNull();
    });
  });

  describe("command palette state", () => {
    it("defaults closed with an empty value", () => {
      const state = useTUIStore.getState();
      expect(state.commandPaletteOpen).toBe(false);
      expect(state.commandPaletteValue).toBe("");
    });

    it("setCommandPaletteOpen toggles the flag", () => {
      useTUIStore.getState().setCommandPaletteOpen(true);
      expect(useTUIStore.getState().commandPaletteOpen).toBe(true);
      useTUIStore.getState().setCommandPaletteOpen(false);
      expect(useTUIStore.getState().commandPaletteOpen).toBe(false);
    });

    it("setCommandPaletteValue stores the typed text", () => {
      useTUIStore.getState().setCommandPaletteValue("logout");
      expect(useTUIStore.getState().commandPaletteValue).toBe("logout");
    });

    it("closing resets the buffered value so the next open starts fresh", () => {
      useTUIStore.getState().setCommandPaletteOpen(true);
      useTUIStore.getState().setCommandPaletteValue("logo");
      useTUIStore.getState().setCommandPaletteOpen(false);
      expect(useTUIStore.getState().commandPaletteValue).toBe("");
    });
  });

  describe("setToast", () => {
    it("stores a one-shot success toast", () => {
      useTUIStore.getState().setToast({
        kind: "success",
        message: "Evaluation queued",
      });
      const state = useTUIStore.getState();
      expect(state.toast).toEqual({
        kind: "success",
        message: "Evaluation queued",
      });
    });

    it("accepts null to clear the toast", () => {
      useTUIStore.getState().setToast({ kind: "info", message: "hi" });
      expect(useTUIStore.getState().toast).not.toBeNull();
      useTUIStore.getState().setToast(null);
      expect(useTUIStore.getState().toast).toBeNull();
    });
  });

  describe("dashboard state (Wave 5)", () => {
    const seedSession = (id: string): SessionState => ({
      id,
      phase: "queued",
      autouserId: "built-in:casual-browser",
      autouserName: "Casual Browser",
      autouserIcon: "smart_toy",
      currentComparison: 0,
      totalComparisons: 1,
      ratingsCreated: 0,
      inputTokens: 0,
      outputTokens: 0,
      costUsd: 0,
    });

    it("upsertSession adds and replaces by id", () => {
      const a = seedSession("r1");
      useTUIStore.getState().upsertSession(a);
      expect(useTUIStore.getState().sessions.get("r1")).toEqual(a);

      const updated = { ...a, phase: "running" as SessionState["phase"] };
      useTUIStore.getState().upsertSession(updated);
      expect(useTUIStore.getState().sessions.get("r1")?.phase).toBe("running");
      expect(useTUIStore.getState().sessions.size).toBe(1);
    });

    it("upsertSession produces a new Map reference each call", () => {
      const before = useTUIStore.getState().sessions;
      useTUIStore.getState().upsertSession(seedSession("r1"));
      const after = useTUIStore.getState().sessions;
      // New reference is the contract zustand subscribers depend on for
      // re-render gating.
      expect(after).not.toBe(before);
    });

    it("setProgress / setCost mutate aggregates", () => {
      useTUIStore.getState().setProgress({
        completed: 2,
        total: 5,
        errors: 1,
      });
      expect(useTUIStore.getState().progress).toEqual({
        completed: 2,
        total: 5,
        errors: 1,
      });

      useTUIStore.getState().setCost({
        inputTokens: 100,
        outputTokens: 50,
        totalCost: 0.42,
      });
      expect(useTUIStore.getState().cost.totalCost).toBeCloseTo(0.42);
    });

    it("setEvaluationId / setRunStartedAt / setRunComplete update", () => {
      useTUIStore.getState().setEvaluationId("eval_abc");
      expect(useTUIStore.getState().evaluationId).toBe("eval_abc");

      useTUIStore.getState().setRunStartedAt(1700000000000);
      expect(useTUIStore.getState().runStartedAt).toBe(1700000000000);

      useTUIStore.getState().setRunComplete(true);
      expect(useTUIStore.getState().runComplete).toBe(true);
    });

    it("resetDashboard restores defaults without touching auth/screen", () => {
      useTUIStore.getState().setAuthUser({ email: "a@b" });
      useTUIStore.getState().setEvaluationId("eval_x");
      useTUIStore.getState().upsertSession(seedSession("r1"));
      useTUIStore.getState().setProgress({
        completed: 3,
        total: 4,
        errors: 0,
      });
      useTUIStore.getState().setRunComplete(true);

      useTUIStore.getState().resetDashboard();

      const s = useTUIStore.getState();
      expect(s.evaluationId).toBeNull();
      expect(s.sessions.size).toBe(0);
      expect(s.progress).toEqual({ completed: 0, total: 0, errors: 0 });
      expect(s.runComplete).toBe(false);
      // Auth + screen unchanged
      expect(s.authUser?.email).toBe("a@b");
    });
  });
});
