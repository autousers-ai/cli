/**
 * Drill-in view for a single session selected from the dashboard.
 *
 * Adapted from uxrater. Uxrater's view rendered a transcript scroll
 * (every {turn, action, observation} entry from its local agent
 * loop). The autousers server doesn't stream per-turn detail — only
 * the latest `currentStep`, `currentAction`, and `currentNarration`
 * — so this view shows phase + step + comparison count + tokens
 * instead of a transcript. When the run completes the
 * `ratingSummary` is rendered.
 */
import { Box, Text, useInput } from "@jrichman/ink";
import { Spinner } from "@inkjs/ui";

import type { SessionState } from "../../state.js";
import { Theme } from "../../theme.js";

interface LiveSessionViewProps {
  session: SessionState;
  onBack: () => void;
}

export function LiveSessionView({ session, onBack }: LiveSessionViewProps) {
  useInput((_input, key) => {
    if (key.escape) onBack();
  });

  const isActive =
    session.phase === "navigating" || session.phase === "judging";

  return (
    <Box flexDirection="column" paddingX={2} marginY={1}>
      <Box gap={2}>
        <Text bold color={Theme.brand}>
          {session.autouserName}
        </Text>
        <Text dimColor>{session.id}</Text>
      </Box>

      <Box gap={2} marginTop={1}>
        <Text>Phase:</Text>
        <Text bold>{session.phase}</Text>
        {session.currentStep && (
          <>
            <Text dimColor>· Step:</Text>
            <Text>{session.currentStep}</Text>
          </>
        )}
      </Box>

      <Box gap={2}>
        <Text>Progress:</Text>
        <Text>
          {session.currentComparison}/{session.totalComparisons || 1}{" "}
          comparisons
        </Text>
      </Box>

      <Box gap={2}>
        <Text>Tokens:</Text>
        <Text>
          {session.inputTokens} in / {session.outputTokens} out
        </Text>
        <Text dimColor>· ${session.costUsd.toFixed(4)}</Text>
      </Box>

      {isActive && (
        <Box gap={1} marginTop={1}>
          <Spinner />
          <Text color="green">
            {session.phase === "navigating" ? "Navigating..." : "Judging..."}
          </Text>
        </Box>
      )}

      {session.currentNarration && (
        <Box
          flexDirection="column"
          marginTop={1}
          borderStyle="single"
          borderColor="gray"
          paddingX={1}
        >
          <Text bold> Latest narration</Text>
          <Text wrap="wrap">{session.currentNarration}</Text>
        </Box>
      )}

      {session.phase === "complete" && session.result?.ratingSummary && (
        <Box
          flexDirection="column"
          marginTop={1}
          borderStyle="single"
          borderColor="green"
          paddingX={1}
        >
          <Text bold color="green">
            Results
          </Text>
          {typeof session.result.ratingSummary.averageScore === "number" && (
            <Text>
              Average score:{" "}
              <Text bold color="green">
                {session.result.ratingSummary.averageScore.toFixed(1)}
              </Text>
            </Text>
          )}
          {typeof session.result.ratingSummary.sideA === "number" && (
            <Text>
              A: {session.result.ratingSummary.sideA} · =:{" "}
              {session.result.ratingSummary.same ?? 0} · B:{" "}
              {session.result.ratingSummary.sideB ?? 0}
            </Text>
          )}
          <Text dimColor>
            {session.result.ratingSummary.totalRatings} total ratings
          </Text>
        </Box>
      )}

      {session.phase === "error" && session.error && (
        <Box marginTop={1}>
          <Text color="red">Error: {session.error}</Text>
        </Box>
      )}

      <Box marginTop={1}>
        <Text dimColor>Esc → back to dashboard</Text>
      </Box>
    </Box>
  );
}
