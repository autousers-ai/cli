/**
 * Wave 8 — Autorater calibration wizard.
 *
 * Three-step flow:
 *
 *   1. **Status** — fetch current calibration state
 *      (`GET /api/v1/autousers/:id/calibration`). Show kappa /
 *      agreement / status / sample count.
 *   2. **Action** — user picks: start a new calibration run, freeze
 *      the active rubric, or trigger an optimization pass.
 *   3. **Result** — render the API response (kappa drift, frozen
 *      rubric id, optimization summary) and offer to return.
 *
 * The screen is intentionally lightweight — calibration is mostly
 * driven server-side; the CLI's job is to surface state and trigger
 * transitions. Dim-text disclaimers signal that a full review of
 * disagreements + per-sample data is best done in the web app.
 *
 * Routing in: hub presses `c` on a custom row → sets
 * `calibratingAutouserId` in the store → routes here.
 */
import { useEffect, useState } from "react";
import { Box, Text, useInput } from "@jrichman/ink";

import {
  createClientFromConfig,
  type AutousersClient,
} from "../../../client.js";
import { useTUIStore } from "../../state.js";
import { Theme } from "../../theme.js";

interface CalibrationState {
  status: string;
  kappa?: number | null;
  agreement?: number | null;
  sampleSize?: number | null;
  activeRubricId?: string | null;
  message?: string;
}

interface CalibrationStatusEnvelope {
  data: CalibrationState;
}

type Step = "status" | "action" | "running" | "result";
type Action = "start" | "freeze" | "optimize";

interface AutoraterCalibrationProps {
  /** Test seam — substitute the API client factory. */
  createClient?: () => Promise<Pick<AutousersClient, "get" | "post">>;
}

export function AutoraterCalibration(props: AutoraterCalibrationProps = {}) {
  const setScreen = useTUIStore((s) => s.setScreen);
  const calibratingAutouserId = useTUIStore((s) => s.calibratingAutouserId);
  const setCalibratingAutouserId = useTUIStore(
    (s) => s.setCalibratingAutouserId
  );
  const setToast = useTUIStore((s) => s.setToast);

  const [step, setStep] = useState<Step>("status");
  const [calibration, setCalibration] = useState<CalibrationState | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [actionPick, setActionPick] = useState<Action>("start");
  const [resultMessage, setResultMessage] = useState<string | null>(null);

  // Clear the editing/calibrating id on unmount so subsequent visits
  // start fresh.
  useEffect(() => {
    return () => {
      setCalibratingAutouserId(null);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function loadStatus(): Promise<void> {
    if (!calibratingAutouserId) {
      setError("No autouser selected.");
      return;
    }
    setStep("status");
    setError(null);
    try {
      const factory = props.createClient ?? (() => createClientFromConfig({}));
      const client = await Promise.resolve(factory());
      const env = await client.get<CalibrationStatusEnvelope>(
        `/api/v1/autousers/${encodeURIComponent(calibratingAutouserId)}/calibration`
      );
      setCalibration(env.data);
      setStep("action");
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  useEffect(() => {
    void loadStatus();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [calibratingAutouserId]);

  async function performAction(action: Action): Promise<void> {
    if (!calibratingAutouserId) return;
    setStep("running");
    setError(null);
    setResultMessage(null);
    try {
      const factory = props.createClient ?? (() => createClientFromConfig({}));
      const client = await Promise.resolve(factory());
      const path =
        action === "start"
          ? `/api/v1/autousers/${encodeURIComponent(calibratingAutouserId)}/calibration/start`
          : action === "freeze"
            ? `/api/v1/autousers/${encodeURIComponent(calibratingAutouserId)}/calibration/freeze`
            : `/api/v1/autousers/${encodeURIComponent(calibratingAutouserId)}/calibration/optimize`;
      const env = await client.post<{
        data: { message?: string; status?: string; kappa?: number };
      }>(path, {});
      setResultMessage(
        env.data?.message ??
          `Calibration ${action} succeeded${
            env.data?.kappa !== undefined ? ` (κ=${env.data.kappa})` : ""
          }`
      );
      setStep("result");
      setToast({
        kind: "success",
        message: `Calibration ${action} done`,
      });
      setTimeout(() => setToast(null), 3000);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setStep("action");
    }
  }

  useInput((input, key) => {
    if (step === "running") return;

    if (key.escape) {
      setScreen("autoraters-hub");
      return;
    }
    if (step === "action") {
      if (key.upArrow || key.downArrow) {
        const order: Action[] = ["start", "freeze", "optimize"];
        const idx = order.indexOf(actionPick);
        const next = key.upArrow
          ? order[Math.max(0, idx - 1)]!
          : order[Math.min(order.length - 1, idx + 1)]!;
        setActionPick(next);
        return;
      }
      if (key.return) {
        void performAction(actionPick);
        return;
      }
      if (input === "s") {
        void performAction("start");
        return;
      }
      if (input === "f") {
        void performAction("freeze");
        return;
      }
      if (input === "o") {
        void performAction("optimize");
        return;
      }
      if (input === "r") {
        void loadStatus();
        return;
      }
    }
    if (step === "result") {
      if (key.return || input === "r") {
        void loadStatus();
        return;
      }
    }
  });

  return (
    <Box flexDirection="column" paddingX={1} paddingY={1}>
      <Box paddingBottom={1}>
        <Text bold color={Theme.brand}>
          Calibration
        </Text>
        <Text dimColor>
          {"  "}({calibratingAutouserId ?? "—"})
        </Text>
      </Box>

      {error ? (
        <Box marginBottom={1}>
          <Text color={Theme.error}>Error: {error}</Text>
        </Box>
      ) : null}

      {step === "status" ? (
        <Text color={Theme.brand}>Loading calibration state…</Text>
      ) : null}

      {step !== "status" && calibration ? (
        <Box flexDirection="column" gap={0}>
          <Box gap={2}>
            <Box width={14}>
              <Text bold>Status:</Text>
            </Box>
            <Text>{calibration.status}</Text>
          </Box>
          <Box gap={2}>
            <Box width={14}>
              <Text bold>κ (kappa):</Text>
            </Box>
            <Text>{formatNumber(calibration.kappa)}</Text>
          </Box>
          <Box gap={2}>
            <Box width={14}>
              <Text bold>Agreement:</Text>
            </Box>
            <Text>{formatNumber(calibration.agreement)}</Text>
          </Box>
          {/* Not "Samples": the unit is the (comparison, dimension) pair, so a
              design scored on four dimensions contributes four observations.
              Calibration runs recorded before the unit change counted paired
              comparisons, so this figure is only comparable between recent
              runs. */}
          <Box gap={2}>
            <Box width={14}>
              <Text bold>Paired obs:</Text>
            </Box>
            <Text>
              {calibration.sampleSize !== undefined &&
              calibration.sampleSize !== null
                ? String(calibration.sampleSize)
                : "—"}
            </Text>
          </Box>
        </Box>
      ) : null}

      {step === "action" ? (
        <Box flexDirection="column" marginTop={1}>
          <Text bold>Pick an action:</Text>
          {(["start", "freeze", "optimize"] as const).map((act) => (
            <Box key={act} gap={1}>
              <Text
                color={actionPick === act ? Theme.brand : undefined}
                bold={actionPick === act}
              >
                {actionPick === act ? ">" : " "}
              </Text>
              <Text>
                {act === "start"
                  ? "Start a new calibration run"
                  : act === "freeze"
                    ? "Freeze active rubric"
                    : "Optimize rubric (model-driven)"}
              </Text>
            </Box>
          ))}
        </Box>
      ) : null}

      {step === "running" ? (
        <Box marginTop={1}>
          <Text color={Theme.brand}>Calibration request in flight…</Text>
        </Box>
      ) : null}

      {step === "result" ? (
        <Box marginTop={1} flexDirection="column">
          <Text color={Theme.success}>✔ {resultMessage}</Text>
        </Box>
      ) : null}

      <Box paddingTop={1}>
        <Text dimColor>{footerHint(step)}</Text>
      </Box>
    </Box>
  );
}

function formatNumber(n: number | null | undefined): string {
  if (n === undefined || n === null || !Number.isFinite(n)) return "—";
  return n.toFixed(3);
}

function footerHint(step: Step): string {
  if (step === "status") return "Loading…";
  if (step === "action")
    return "↑↓ pick · Enter run · s start · f freeze · o optimize · r refresh · Esc back";
  if (step === "running") return "Please wait…";
  if (step === "result") return "Enter / r refresh status · Esc back";
  return "";
}
