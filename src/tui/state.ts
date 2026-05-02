/**
 * Zustand store for the autousers CLI TUI.
 *
 * Wave 2 kept this minimal (active screen + authUser). Wave 3 added the
 * `menu` and `loading-auth` screens plus a `placeholderTarget` field.
 * Wave 4 introduced `eval-creator`. Wave 5 lands the live-dashboard
 * surface — sessions Map, run progress, total cost, current evaluation
 * id, plus two new screens (`dashboard`, `live-session`).
 *
 * Ported from uxrater's `cli/state.ts`. The session phase / cost shape
 * is retained, but the input that drives state updates is the SSE
 * adapter rather than uxrater's local-runner event bus.
 */
import { create } from "zustand";

import type { SessionPhase, SessionResultSummary } from "./events.js";

/**
 * Currently visible screen.
 *
 * Wave 5 adds:
 *   - `dashboard`     — live-run dashboard (cost ticker + session list +
 *                       error panel). Mounted after eval-creator confirm
 *                       or via `eval run` with TUI mode.
 *   - `live-session`  — drill-in view for a single session selected from
 *                       the dashboard. Renders metadata only — server
 *                       SSE doesn't stream transcripts.
 *
 * Wave 6 adds:
 *   - `results`       — tabbed results view (overall / comparisons /
 *                       stats / cost). The dashboard auto-transitions
 *                       here when `run:complete` fires; users can also
 *                       enter from the eval-history browser (Wave 7).
 *
 * Wave 7 adds:
 *   - `eval-history`        — paginated browse + filter list of past
 *                              evaluations. Replaces the wave-3
 *                              placeholder for menu item 2.
 *   - `eval-results-by-id`  — Wave 6's ResultsView reused, entered from
 *                              the history list (Esc → back to history,
 *                              not back to the menu).
 */
export type Screen =
  | "welcome"
  | "menu"
  | "placeholder"
  | "loading-auth"
  | "eval-creator"
  | "dashboard"
  | "live-session"
  | "results"
  | "eval-history"
  | "eval-results-by-id"
  | "autoraters-hub"
  | "autorater-creator"
  | "autorater-calibration"
  | "templates-hub"
  | "template-creator"
  | "settings"
  | "teams-section"
  | "usage-section"
  | "connected-apps-section";

/**
 * Identifier for the still-unshipped wave-9-10 screens that the menu
 * routes through `placeholder`. Once a wave lands its real screen, the
 * matching entry here drops. Wave 7 dropped `eval-history`, Wave 8
 * dropped `autouser-hub`, Wave 9 drops `template-hub` and `settings`
 * — the menu now routes directly to the real screens. The placeholder
 * type union retains a non-empty shape using `"never"` so future waves
 * have a place to land before their screens ship.
 */
export type PlaceholderTarget = "never";

/**
 * Resolved authenticated user, mirrored from `/api/v1/auth/whoami`.
 */
export interface AuthUser {
  email: string;
  teamName?: string;
  plan?: string;
  freeRunsLeft?: number;
  freeRunsTotal?: number;
}

/**
 * Lightweight toast surfaced from the wizard / app on certain successful
 * mutations.
 */
export interface Toast {
  kind: "success" | "info" | "error";
  message: string;
}

/**
 * Per-session state mirrored from the SSE stream. `id` is the
 * AutouserRun cuid; the dashboard renders one row per entry.
 *
 * Notes on adaptation from uxrater's `SessionState`:
 *   - uxrater's `transcript` array is intentionally absent — the server
 *     doesn't stream per-turn transcripts. The drill-in view shows
 *     metadata (phase, current step, comparison count, tokens).
 *   - `autouser` is just the stable id ("built-in:casual-browser" or a
 *     custom autouser cuid) plus a display name from the SSE payload
 *     — we don't keep the full Autouser row.
 */
export interface SessionState {
  id: string;
  phase: SessionPhase;
  autouserId: string;
  autouserName: string;
  autouserIcon: string;
  currentStep?: string;
  currentComparison: number;
  totalComparisons: number;
  ratingsCreated: number;
  inputTokens: number;
  outputTokens: number;
  costUsd: number;
  error?: string;
  result?: SessionResultSummary;
  /** When the run first transitioned to `running`. ms since epoch. */
  startedAt?: number;
  /** When the run reached terminal status. ms since epoch. */
  completedAt?: number;
  currentAction?: string;
  currentNarration?: string;
}

/**
 * Aggregate run progress mirrored from the SSE stream's `run:progress`
 * synthesis. The server's `snapshot` event seeds it; subsequent
 * `run_update` / `run_complete` events bump the counts.
 */
export interface RunProgress {
  completed: number;
  total: number;
  errors: number;
}

/**
 * Aggregate cost ticker. We collapse uxrater's nav/judging split into a
 * single bucket because the server only exposes combined token counts
 * per run. If the server ever splits per-phase tokens, widen this here
 * and the cost-ticker component picks them up.
 */
export interface RunCostAggregate {
  inputTokens: number;
  outputTokens: number;
  totalCost: number;
}

/**
 * Filter state for the Wave 7 eval-history list. All optional — `null` /
 * empty means "no filter on this dimension". The filter bar in
 * `<EvalHistory>` mutates these via the store; the rendered list applies
 * them client-side over the page returned from `GET /api/v1/evaluations`.
 */
export interface HistoryFilters {
  /** "All" if null. Server statuses: Draft / Running / Ended / Archived. */
  status: string | null;
  /** "All" if null. SSE | SxS. */
  type: "SSE" | "SxS" | null;
  /** Date-range presets: "all" | "7d" | "30d" | "90d". */
  range: "all" | "7d" | "30d" | "90d";
  /** "All" if null. Substring-match against the evaluation owner / team. */
  owner: string | null;
}

/**
 * Sort order cycled with `c` on the history list.
 *   - `created-desc`  newest first (default)
 *   - `name`          alphabetical by name
 *   - `cost-desc`     highest spend first (best-effort — relies on the
 *                     server returning `metadata.totalCost`; falls back
 *                     to ratingsCount if absent so the order is stable)
 */
export type HistorySort = "created-desc" | "name" | "cost-desc";

export interface TUIState {
  screen: Screen;
  authUser: AuthUser | null;
  placeholderTarget: PlaceholderTarget | null;
  toast: Toast | null;

  // ---- Slash command palette ----
  /**
   * Whether the slash-command palette is currently open. When `true` an
   * inline modal renders at the bottom of the TUI, captures input, and
   * dispatches a registered command on Enter. Pressing `/` from a screen
   * that doesn't own a text input toggles this on; Esc / dispatch / route
   * change toggle it back off.
   */
  commandPaletteOpen: boolean;
  /** Current text the user has typed into the palette's input field. */
  commandPaletteValue: string;

  // ---- Wave 5: live dashboard ----
  /** Active evaluation id whose runs the dashboard is watching. */
  evaluationId: string | null;
  /** Map of AutouserRun.id → its dashboard-shaped state. */
  sessions: Map<string, SessionState>;
  /** Aggregate run progress used by header + progress bar. */
  progress: RunProgress;
  /** Aggregate cost used by the ticker. */
  cost: RunCostAggregate;
  /** ms since epoch when the run started (i.e. dashboard mounted). */
  runStartedAt: number | null;
  /** Drill-in target — which session the live-session view shows. */
  drillSessionId: string | null;
  /** Set true once the SSE stream emits `done`. */
  runComplete: boolean;

  // ---- Wave 7: eval-history browser ----
  /**
   * Currently selected eval id when entering the results-by-id screen
   * from the history list. Distinct from `evaluationId` (which is owned
   * by the live-dashboard / completed-run flow) so that re-opening an
   * old eval from history doesn't clobber an in-flight run.
   */
  selectedEvalId: string | null;
  /** Free-text search applied to evaluation names. */
  historyQuery: string;
  /** Filter bar state. */
  historyFilters: HistoryFilters;
  /** Sort order cycled by `c`. */
  historySort: HistorySort;

  // ---- Wave 8: autouser hub / creator / calibration ----
  /**
   * When set, the autorater-creator screen loads the existing autouser
   * with this id and pre-populates the form for editing rather than
   * creating fresh. Cleared by the creator on unmount.
   */
  editingAutouserId: string | null;
  /**
   * Autouser id whose calibration wizard is currently mounted. The hub
   * sets this before navigating to `autorater-calibration` so the
   * calibration screen knows which row to act on. Cleared on unmount.
   */
  calibratingAutouserId: string | null;

  // ---- Wave 9: templates / settings / teams / api keys ----
  /**
   * When set, the template-creator screen loads the existing template
   * (via `GET /api/v1/templates/:id`) and pre-populates the form for
   * editing rather than creating fresh. Cleared by the creator on
   * unmount.
   */
  editingTemplateId: string | null;
  /**
   * Active team slug — persisted to `~/.autousers/config.json` so
   * subsequent commands implicitly scope to the chosen team. The TUI
   * surfaces this in the header (Wave 9 polish) and lets the user
   * switch via the Settings → Teams sub-screen. Plain-mode equivalent:
   * `autousers team use <slug>`.
   */
  activeTeamSlug: string | null;

  setScreen: (screen: Screen) => void;
  setAuthUser: (user: AuthUser | null) => void;
  setPlaceholderTarget: (target: PlaceholderTarget | null) => void;
  setToast: (toast: Toast | null) => void;

  // ---- Slash command palette setters ----
  setCommandPaletteOpen: (open: boolean) => void;
  setCommandPaletteValue: (value: string) => void;

  // ---- Wave 5 setters ----
  setEvaluationId: (id: string | null) => void;
  upsertSession: (session: SessionState) => void;
  setProgress: (progress: RunProgress) => void;
  setCost: (cost: RunCostAggregate) => void;
  setRunStartedAt: (ts: number | null) => void;
  setDrillSessionId: (id: string | null) => void;
  setRunComplete: (done: boolean) => void;
  /** Reset Wave-5 fields back to their initial values. */
  resetDashboard: () => void;

  // ---- Wave 7 setters ----
  setSelectedEvalId: (id: string | null) => void;
  setHistoryQuery: (q: string) => void;
  setHistoryFilters: (filters: HistoryFilters) => void;
  setHistorySort: (sort: HistorySort) => void;

  // ---- Wave 8 setters ----
  setEditingAutouserId: (id: string | null) => void;
  setCalibratingAutouserId: (id: string | null) => void;

  // ---- Wave 9 setters ----
  setEditingTemplateId: (id: string | null) => void;
  setActiveTeamSlug: (slug: string | null) => void;
}

const initialDashboardState = {
  evaluationId: null as string | null,
  sessions: new Map<string, SessionState>(),
  progress: { completed: 0, total: 0, errors: 0 } as RunProgress,
  cost: { inputTokens: 0, outputTokens: 0, totalCost: 0 } as RunCostAggregate,
  runStartedAt: null as number | null,
  drillSessionId: null as string | null,
  runComplete: false,
};

const initialHistoryState = {
  selectedEvalId: null as string | null,
  historyQuery: "",
  historyFilters: {
    status: null,
    type: null,
    range: "all",
    owner: null,
  } as HistoryFilters,
  historySort: "created-desc" as HistorySort,
};

const initialAutouserHubState = {
  editingAutouserId: null as string | null,
  calibratingAutouserId: null as string | null,
};

const initialTemplatesAndSettingsState = {
  editingTemplateId: null as string | null,
  activeTeamSlug: null as string | null,
};

export const useTUIStore = create<TUIState>((set) => ({
  screen: "menu",
  authUser: null,
  placeholderTarget: null,
  toast: null,
  commandPaletteOpen: false,
  commandPaletteValue: "",

  ...initialDashboardState,
  ...initialHistoryState,
  ...initialAutouserHubState,
  ...initialTemplatesAndSettingsState,

  setScreen: (screen) => set({ screen }),
  setAuthUser: (authUser) => set({ authUser }),
  setPlaceholderTarget: (placeholderTarget) => set({ placeholderTarget }),
  setToast: (toast) => set({ toast }),

  setCommandPaletteOpen: (commandPaletteOpen) =>
    // Always reset the buffered value when toggling closed so the next
    // open starts fresh — opening half-typed state would be confusing.
    set(
      commandPaletteOpen
        ? { commandPaletteOpen }
        : { commandPaletteOpen, commandPaletteValue: "" }
    ),
  setCommandPaletteValue: (commandPaletteValue) => set({ commandPaletteValue }),

  setEvaluationId: (evaluationId) => set({ evaluationId }),
  upsertSession: (session) =>
    set((state) => {
      // Zustand stores compare by reference for re-render gating, so we
      // build a fresh Map even if the session already exists. Cost of a
      // shallow clone is negligible at <100 sessions; keeps the
      // dashboard memo invalidation predictable.
      const next = new Map(state.sessions);
      next.set(session.id, session);
      return { sessions: next };
    }),
  setProgress: (progress) => set({ progress }),
  setCost: (cost) => set({ cost }),
  setRunStartedAt: (runStartedAt) => set({ runStartedAt }),
  setDrillSessionId: (drillSessionId) => set({ drillSessionId }),
  setRunComplete: (runComplete) => set({ runComplete }),
  resetDashboard: () =>
    set({
      ...initialDashboardState,
      sessions: new Map<string, SessionState>(),
    }),

  setSelectedEvalId: (selectedEvalId) => set({ selectedEvalId }),
  setHistoryQuery: (historyQuery) => set({ historyQuery }),
  setHistoryFilters: (historyFilters) => set({ historyFilters }),
  setHistorySort: (historySort) => set({ historySort }),

  setEditingAutouserId: (editingAutouserId) => set({ editingAutouserId }),
  setCalibratingAutouserId: (calibratingAutouserId) =>
    set({ calibratingAutouserId }),

  setEditingTemplateId: (editingTemplateId) => set({ editingTemplateId }),
  setActiveTeamSlug: (activeTeamSlug) => set({ activeTeamSlug }),
}));
