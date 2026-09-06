/**
 * Comparisons tab — per-comparison head-to-head bars (SxS) or score
 * bars (SSE). Hidden entirely on SSE evals via the parent's tab logic.
 *
 * Adapted from uxrater's `tab-comparisons.tsx`. The drill-in detail view
 * (per-rating table + factor analysis) was uxrater-specific and depended
 * on the local-runner SessionState having full transcripts; we render a
 * simpler list of comparisons here. Full drill-in lives at the dashboard
 * web URL (the `o` keybind opens it).
 */
import { Box, Text } from "@jrichman/ink";

import { ScoreBar } from "./score-bar.js";
import type { ComparisonSummary, ResultsData } from "./use-results-data.js";

interface TabComparisonsProps {
  data: ResultsData;
  selectedRow: number;
}

function scoreColor(score: number, max: number): string {
  const ratio = score / max;
  if (ratio >= 0.8) return "green";
  if (ratio >= 0.6) return "yellow";
  if (ratio >= 0.4) return "white";
  return "red";
}

function winnerLabel(summary: ComparisonSummary): string {
  if (summary.isSSE) return summary.overallAvg.toFixed(1);
  if (summary.winner === "sideA") return "A";
  if (summary.winner === "sideB") return "B";
  if (summary.winner === "tie") return "Tie";
  return "—";
}

function winnerColor(summary: ComparisonSummary): string {
  if (summary.isSSE) return scoreColor(summary.overallAvg, 5);
  if (summary.winner === "sideA") return "green";
  if (summary.winner === "sideB") return "magenta";
  return "gray";
}

export function TabComparisons({ data, selectedRow }: TabComparisonsProps) {
  const { summaries, isSSE } = data;
  const labelWidth = 24;

  if (summaries.length === 0) {
    return (
      <Box>
        <Text dimColor>No comparisons to display.</Text>
      </Box>
    );
  }

  const selected = summaries[selectedRow];

  return (
    <Box flexDirection="column" gap={1}>
      {/* Table */}
      <Box flexDirection="column">
        <Box gap={0}>
          <Box width={labelWidth + 2}>
            <Text dimColor>{isSSE ? "  Design" : "  Comparison"}</Text>
          </Box>
          <Box width={6}>
            <Text dimColor>Runs</Text>
          </Box>
          <Box width={10}>
            <Text dimColor>{isSSE ? "Avg" : "Winner"}</Text>
          </Box>
          <Box width={12}>
            <Text dimColor>Confidence</Text>
          </Box>
          <Box width={8}>
            <Text dimColor>{isSSE ? "Score" : "Avg"}</Text>
          </Box>
        </Box>
        <Text dimColor>{"─".repeat(62)}</Text>

        {summaries.map((summary, i) => (
          <Box key={summary.comparisonId} gap={0}>
            <Box width={labelWidth + 2}>
              <Text inverse={i === selectedRow}>
                {(i === selectedRow ? "> " : "  ") +
                  summary.label.slice(0, labelWidth - 2).padEnd(labelWidth - 2)}
              </Text>
            </Box>
            <Box width={6}>
              <Text>{summary.runCount + "x"}</Text>
            </Box>
            <Box width={10}>
              <Text bold color={winnerColor(summary)}>
                {winnerLabel(summary)}
              </Text>
            </Box>
            <Box width={12}>
              <Text
                color={
                  summary.confidence === "High"
                    ? "green"
                    : summary.confidence === "Medium"
                      ? "yellow"
                      : "gray"
                }
              >
                {summary.confidence ?? "—"}
              </Text>
            </Box>
            <Box width={8}>
              <Text>{summary.overallAvg.toFixed(1)}</Text>
            </Box>
          </Box>
        ))}
      </Box>

      {/* Selected row detail */}
      {selected && (
        <Box
          flexDirection="column"
          borderStyle="single"
          borderColor="gray"
          paddingX={1}
        >
          <Text bold color="blue">
            {selected.label}
          </Text>
          <Box gap={2} marginTop={1}>
            {selected.isSSE ? (
              <>
                <Text>Score:</Text>
                <ScoreBar score={selected.overallAvg} max={5} />
              </>
            ) : (
              <>
                <Text bold>
                  Winner:{" "}
                  <Text color={winnerColor(selected)}>
                    {winnerLabel(selected)}
                  </Text>
                </Text>
                <Text dimColor>
                  A {selected.sideAWins ?? 0} · B {selected.sideBWins ?? 0} ·
                  Tied {selected.ties ?? 0}
                </Text>
              </>
            )}
          </Box>
        </Box>
      )}
    </Box>
  );
}
