/**
 * One row in the dashboard session list.
 *
 * Adapted from uxrater. The autousers server emits `currentAction` and
 * `currentNarration` chips on each meaningful state change; we surface
 * the action (≤40 chars) inline. Uxrater's per-dimension result chips
 * are dropped because the SSE payload only ships an aggregate
 * `ratingSummary` (totalRatings + averageScore for SSE,
 * sideA/same/sideB for SxS).
 */
import { memo } from "react";
import { Box, Text } from "@jrichman/ink";
import { Spinner } from "@inkjs/ui";

import type { SessionState } from "../../state.js";

interface SessionRowProps {
  session: SessionState;
  selected?: boolean;
  verbose?: boolean;
}

function phaseBadge(
  phase: SessionState["phase"]
): { text: string; color: string } | undefined {
  switch (phase) {
    case "navigating":
      return { text: "[NAV]", color: "green" };
    case "judging":
      return { text: "[JUDGE]", color: "blue" };
    case "complete":
      return { text: "[DONE]", color: "green" };
    case "error":
      return { text: "[ERR]", color: "red" };
    case "queued":
      return { text: "[WAIT]", color: "gray" };
    default:
      return undefined;
  }
}

function formatAction(action: string): string {
  return action.length > 40 ? action.slice(0, 39) + "…" : action;
}

function summaryLine(session: SessionState): string {
  if (session.phase !== "complete" || !session.result) return "";
  const sum = session.result.ratingSummary;
  if (!sum) return `${session.result.ratingsCreated} ratings`;
  if (typeof sum.averageScore === "number") {
    return `avg ${sum.averageScore.toFixed(1)} · ${sum.totalRatings} rating${sum.totalRatings === 1 ? "" : "s"}`;
  }
  if (typeof sum.sideA === "number") {
    return `A:${sum.sideA} =:${sum.same ?? 0} B:${sum.sideB ?? 0}`;
  }
  return `${sum.totalRatings} ratings`;
}

export const SessionRow = memo(function SessionRow({
  session,
  selected = false,
  verbose = false,
}: SessionRowProps) {
  const badge = phaseBadge(session.phase);
  const turnInfo =
    session.phase === "navigating" || session.phase === "judging"
      ? `${session.currentComparison}/${session.totalComparisons || 1}`
      : "";

  return (
    <Box flexDirection="column">
      <Box gap={1}>
        {selected && <Text color="cyan">▶</Text>}
        {session.phase === "complete" ? (
          <Text color="green">{selected ? "✔" : " ✔"}</Text>
        ) : session.phase === "error" ? (
          <Text color="red">{selected ? "✘" : " ✘"}</Text>
        ) : session.phase === "queued" ? (
          <Text dimColor>{selected ? "⏳" : " ⏳"}</Text>
        ) : (
          <Box width={2}>
            <Spinner />
          </Box>
        )}
        {badge && <Text color={badge.color}>{badge.text}</Text>}
        <Text>{session.autouserName}</Text>
        <Text dimColor>{session.id.slice(0, 8)}…</Text>
        {turnInfo && <Text dimColor>{turnInfo}</Text>}
        {session.currentAction &&
          (session.phase === "navigating" || session.phase === "judging") && (
            <Text dimColor>{formatAction(session.currentAction)}</Text>
          )}
        {session.phase === "complete" && (
          <Text color="green">{summaryLine(session)}</Text>
        )}
        {session.phase === "error" && session.error && (
          <Text color="red">{session.error.slice(0, 50)}</Text>
        )}
      </Box>

      {(selected || verbose) && (
        <Box flexDirection="column" paddingLeft={4} marginBottom={0}>
          <Box gap={2}>
            <Text dimColor>Autouser:</Text>
            <Text>{session.autouserName}</Text>
            <Text dimColor>Tokens:</Text>
            <Text dimColor>
              {session.inputTokens}+{session.outputTokens}
            </Text>
          </Box>
          {session.currentNarration &&
            (session.phase === "navigating" || session.phase === "judging") && (
              <Box gap={2}>
                <Text dimColor>Step:</Text>
                <Text dimColor wrap="wrap">
                  {session.currentNarration}
                </Text>
              </Box>
            )}
        </Box>
      )}
    </Box>
  );
});
