/**
 * Live-run dashboard for an active evaluation.
 *
 * Adapted from uxrater. The big delta is the data source: uxrater
 * subscribed to its local-runner event bus (which it owned), here we
 * subscribe to the SSE adapter via {@link runEval} and let it push
 * TUIEvents onto a shared bus. All state derived from those events
 * lives in the zustand store, so this component is a presentation
 * layer over the store + a few keybinds.
 *
 * Keybinds:
 *   - q       quit
 *   - s       stop run (POST /stop-autousers, with confirm)
 *   - ↑↓      select session
 *   - Enter   drill into selected session
 *   - Esc     deselect / back from drill-in
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { Box, Text, useApp, useInput } from "@jrichman/ink";

import {
  createClientFromConfig,
  type AutousersClient,
} from "../../../client.js";
import { TUIEventBus } from "../../events.js";
import { runEval, type RunEvalHandle } from "../../runner.js";
import { useTUIStore, type SessionState } from "../../state.js";
import { Theme } from "../../theme.js";
import { CostTicker } from "./cost-ticker.js";
import { ErrorPanel } from "./error-panel.js";
import { LiveSessionView } from "./live-session-view.js";
import { ProgressBar } from "./progress-bar.js";
import { SessionList } from "./session-list.js";

/**
 * Props are entirely optional — the dashboard reads `evaluationId`
 * from the store. Tests inject a mocked client + event bus to avoid
 * spinning up the real fetch stack. Production callers omit them.
 */
export interface DashboardProps {
  /** Override for the API client factory (tests). */
  createClient?: () => Promise<Pick<AutousersClient, "post">>;
  /** Override for the bearer-resolver / SSE runner (tests). */
  startRunner?: (
    evaluationId: string,
    bus: TUIEventBus
  ) => RunEvalHandle | null;
  /** Pre-seeded bus (tests). */
  bus?: TUIEventBus;
}

function deriveSessionFromEvent(
  prev: SessionState | undefined,
  patch: Partial<SessionState> & { id: string }
): SessionState {
  return {
    id: patch.id,
    phase: patch.phase ?? prev?.phase ?? "queued",
    autouserId: patch.autouserId ?? prev?.autouserId ?? "unknown",
    autouserName:
      patch.autouserName ?? prev?.autouserName ?? patch.autouserId ?? "unknown",
    autouserIcon: patch.autouserIcon ?? prev?.autouserIcon ?? "smart_toy",
    currentStep: patch.currentStep ?? prev?.currentStep,
    currentComparison: patch.currentComparison ?? prev?.currentComparison ?? 0,
    totalComparisons: patch.totalComparisons ?? prev?.totalComparisons ?? 0,
    ratingsCreated: patch.ratingsCreated ?? prev?.ratingsCreated ?? 0,
    inputTokens: patch.inputTokens ?? prev?.inputTokens ?? 0,
    outputTokens: patch.outputTokens ?? prev?.outputTokens ?? 0,
    costUsd: patch.costUsd ?? prev?.costUsd ?? 0,
    error: patch.error ?? prev?.error,
    result: patch.result ?? prev?.result,
    startedAt: patch.startedAt ?? prev?.startedAt,
    completedAt: patch.completedAt ?? prev?.completedAt,
    currentAction: patch.currentAction ?? prev?.currentAction,
    currentNarration: patch.currentNarration ?? prev?.currentNarration,
  };
}

export function Dashboard(props: DashboardProps = {}) {
  const { exit } = useApp();
  const evaluationId = useTUIStore((s) => s.evaluationId);
  const sessionsMap = useTUIStore((s) => s.sessions);
  const progress = useTUIStore((s) => s.progress);
  const cost = useTUIStore((s) => s.cost);
  const runStartedAt = useTUIStore((s) => s.runStartedAt);
  const drillSessionId = useTUIStore((s) => s.drillSessionId);
  const runComplete = useTUIStore((s) => s.runComplete);

  const upsertSession = useTUIStore((s) => s.upsertSession);
  const setProgress = useTUIStore((s) => s.setProgress);
  const setCost = useTUIStore((s) => s.setCost);
  const setRunStartedAt = useTUIStore((s) => s.setRunStartedAt);
  const setDrillSessionId = useTUIStore((s) => s.setDrillSessionId);
  const setRunComplete = useTUIStore((s) => s.setRunComplete);
  const setToast = useTUIStore((s) => s.setToast);

  const [selectedSessionId, setSelectedSessionId] = useState<string | null>(
    null
  );
  const [confirmStop, setConfirmStop] = useState(false);
  const [stopping, setStopping] = useState(false);
  const handleRef = useRef<RunEvalHandle | null>(null);

  // Wire bus subscriptions & start the runner once on mount.
  useEffect(() => {
    if (!evaluationId) return;
    if (runStartedAt === null) setRunStartedAt(Date.now());

    const bus = props.bus ?? new TUIEventBus();

    bus.on("session:start", (e) => {
      const prev = useTUIStore.getState().sessions.get(e.sessionId);
      upsertSession(
        deriveSessionFromEvent(prev, {
          id: e.sessionId,
          phase: "navigating",
          autouserId: e.autouser,
        })
      );
    });

    bus.on("session:result", (e) => {
      const prev = useTUIStore.getState().sessions.get(e.sessionId);
      const next = deriveSessionFromEvent(prev, {
        id: e.sessionId,
        phase: "complete",
        result: e.result,
        ratingsCreated: e.result.ratingsCreated,
        inputTokens: e.cost.inputTokens,
        outputTokens: e.cost.outputTokens,
        costUsd: e.cost.costUsd,
        completedAt: Date.now(),
      });
      upsertSession(next);
      // Bump aggregate cost.
      const c = useTUIStore.getState().cost;
      setCost({
        inputTokens: c.inputTokens + e.cost.inputTokens,
        outputTokens: c.outputTokens + e.cost.outputTokens,
        totalCost: c.totalCost + e.cost.costUsd,
      });
    });

    bus.on("session:error", (e) => {
      // Synthetic stream-level errors use sessionId="__stream__" — surface as a toast.
      if (e.sessionId === "__stream__") {
        setToast({ kind: "error", message: e.error });
        return;
      }
      const prev = useTUIStore.getState().sessions.get(e.sessionId);
      upsertSession(
        deriveSessionFromEvent(prev, {
          id: e.sessionId,
          phase: "error",
          error: e.error,
          completedAt: Date.now(),
        })
      );
    });

    bus.on("run:progress", (e) => {
      setProgress({
        completed: e.completed,
        total: e.total,
        errors: e.errors,
      });
    });

    bus.on("run:complete", () => {
      setRunComplete(true);
      // Wave 6: auto-transition to the results screen once the run is
      // done. We keep `evaluationId` set in the store so the results
      // view can fetch /results for it. The dashboard tear-down in the
      // useEffect cleanup aborts the SSE stream on unmount.
      useTUIStore.getState().setScreen("results");
    });

    // Production path mounts the real runner. Tests override with a
    // mock runner (or pass a pre-seeded bus + omit startRunner).
    if (props.startRunner) {
      handleRef.current = props.startRunner(evaluationId, bus);
    } else {
      // Lazy-resolve the bearer at runtime so we don't have to thread
      // it through every call site. Test path skips this entirely
      // because it passes `startRunner` directly.
      void (async () => {
        try {
          const client = await createClientFromConfig({});
          // The client exposes `baseUrl` but not the bearer; we have
          // to read the active config separately. For the dashboard we
          // route through a small extra import from runner that takes
          // the client's baseUrl + a bearer-resolver. Simpler: inline
          // a tiny bearer probe via the same factory path.
          const { resolveBearerForRunner } = await import("../../runtime.js");
          const bearer = await resolveBearerForRunner();
          handleRef.current = runEval(evaluationId, {
            bearer,
            baseUrl: client.baseUrl,
            bus,
          });
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          setToast({ kind: "error", message: `Stream failed: ${msg}` });
        }
      })();
    }

    return () => {
      handleRef.current?.controller.abort();
      bus.removeAllListeners();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [evaluationId]);

  const sessions = useMemo(
    () => Array.from(sessionsMap.values()),
    [sessionsMap]
  );

  const errors = sessions
    .filter((s) => s.phase === "error" && s.error)
    .map((s) => ({ sessionId: s.id, message: s.error! }));

  const navigableSessions = useMemo(() => {
    const active = sessions.filter(
      (s) => s.phase === "navigating" || s.phase === "judging"
    );
    const completed = sessions.filter((s) => s.phase === "complete").slice(-3);
    const errored = sessions.filter((s) => s.phase === "error");
    return [...active, ...completed, ...errored];
  }, [sessions]);

  const onStop = async (): Promise<void> => {
    if (!evaluationId || stopping) return;
    setStopping(true);
    try {
      const factory = props.createClient ?? (() => createClientFromConfig({}));
      const client = await Promise.resolve(factory());
      await client.post(
        `/api/v1/evaluations/${encodeURIComponent(evaluationId)}/stop-autousers`,
        {}
      );
      setToast({ kind: "info", message: "Stop requested" });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setToast({ kind: "error", message: `Stop failed: ${msg}` });
    } finally {
      setStopping(false);
      setConfirmStop(false);
    }
  };

  useInput((input, key) => {
    if (confirmStop) {
      if (input === "y") {
        void onStop();
      } else if (input === "n" || key.escape) {
        setConfirmStop(false);
      }
      return;
    }

    if (input === "q" || (key.ctrl && input === "c")) {
      handleRef.current?.controller.abort();
      exit();
      return;
    }
    if (input === "s") {
      setConfirmStop(true);
      return;
    }

    if (key.upArrow || key.downArrow) {
      if (navigableSessions.length === 0) return;
      if (!selectedSessionId) {
        setSelectedSessionId(navigableSessions[0]!.id);
        return;
      }
      const idx = navigableSessions.findIndex(
        (s) => s.id === selectedSessionId
      );
      if (idx < 0) {
        setSelectedSessionId(navigableSessions[0]!.id);
        return;
      }
      if (key.upArrow) {
        setSelectedSessionId(navigableSessions[Math.max(0, idx - 1)]!.id);
      } else {
        setSelectedSessionId(
          navigableSessions[Math.min(navigableSessions.length - 1, idx + 1)]!.id
        );
      }
    }

    if (key.return && selectedSessionId) {
      setDrillSessionId(selectedSessionId);
    }

    if (key.escape && !drillSessionId && selectedSessionId) {
      setSelectedSessionId(null);
    }
  });

  const drillSession = drillSessionId
    ? sessionsMap.get(drillSessionId)
    : undefined;

  if (drillSession) {
    return (
      <LiveSessionView
        session={drillSession}
        onBack={() => setDrillSessionId(null)}
      />
    );
  }

  const completedCount = sessions.filter((s) => s.phase === "complete").length;
  const headerLine = `${progress.completed} / ${progress.total} complete · ${progress.errors} error${progress.errors === 1 ? "" : "s"} · $${cost.totalCost.toFixed(2)}`;

  return (
    <Box flexDirection="column" paddingX={1} paddingY={1}>
      <Box gap={2}>
        <Text bold color={Theme.brand}>
          Live run
        </Text>
        <Text>{headerLine}</Text>
        {runComplete && <Text color="green">✔ done</Text>}
      </Box>

      <Box marginTop={1}>
        <ProgressBar
          completed={progress.completed}
          total={progress.total}
          startedAt={runStartedAt}
        />
      </Box>

      <Box marginTop={1} gap={1}>
        <Box flexGrow={1}>
          <SessionList
            sessions={sessions}
            selectedSessionId={selectedSessionId}
          />
        </Box>
        <CostTicker
          inputTokens={cost.inputTokens}
          outputTokens={cost.outputTokens}
          totalCost={cost.totalCost}
          completedCount={completedCount}
        />
      </Box>

      {errors.length > 0 && (
        <Box marginTop={1}>
          <ErrorPanel errors={errors} />
        </Box>
      )}

      {confirmStop && (
        <Box
          marginTop={1}
          borderStyle="single"
          borderColor="yellow"
          paddingX={1}
        >
          <Text>
            Stop the run? <Text bold>y</Text>es / <Text bold>n</Text>o
          </Text>
        </Box>
      )}

      <Box marginTop={1}>
        <Text dimColor>
          ↑↓ select · Enter drill-in · Esc deselect · s stop · q quit
        </Text>
      </Box>
    </Box>
  );
}
