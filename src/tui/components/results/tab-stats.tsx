/**
 * Stats tab — distribution chart + per-dimension breakdown table +
 * agreement metrics. Adapted from uxrater.
 */
import { Box, Text } from "@jrichman/ink";

import { DistributionChart } from "./distribution-chart.js";
import { MetricCards, type MetricCard } from "./metric-cards.js";
import type { ResultsData } from "./use-results-data.js";

interface TabStatsProps {
  data: ResultsData;
}

function agreementColor(pct: number): string {
  if (pct >= 80) return "green";
  if (pct >= 60) return "yellow";
  if (pct >= 40) return "white";
  return "red";
}

export function TabStats({ data }: TabStatsProps) {
  const { isSSE, overall, distribution, allDimIds } = data;

  const cards: MetricCard[] = isSSE
    ? [
        { label: "Designs", value: String(overall.totalComparisons) },
        { label: "Ratings", value: String(overall.totalRatings) },
        {
          label: "Mean Score",
          value: `${(overall.overallAvg ?? 0).toFixed(2)}/5`,
        },
        {
          label: "StdDev",
          value: computeOverallStdDev(data).toFixed(2),
        },
      ]
    : [
        { label: "Comparisons", value: String(overall.totalComparisons) },
        { label: "Ratings", value: String(overall.totalRatings) },
        {
          label: "Mean Score",
          value: computeOverallMean(data).toFixed(2),
        },
        {
          label: "Win/Loss",
          value: computeWinLossRatio(data),
        },
      ];

  return (
    <Box flexDirection="column" gap={1}>
      <MetricCards cards={cards} />

      <Box
        flexDirection="column"
        borderStyle="single"
        borderColor="gray"
        paddingX={1}
      >
        <Text bold> Rating Distribution</Text>
        <DistributionChart data={distribution} isSSE={isSSE} />
      </Box>

      {allDimIds.length > 0 && (
        <Box
          flexDirection="column"
          borderStyle="single"
          borderColor="gray"
          paddingX={1}
        >
          <Text bold> Dimension Breakdown</Text>
          {isSSE ? (
            <SSEDimensionTable data={data} />
          ) : (
            <SxSDimensionTable data={data} />
          )}
        </Box>
      )}

      {data.agreement && data.agreement.pairCount > 0 && (
        <Box
          flexDirection="column"
          borderStyle="single"
          borderColor="gray"
          paddingX={1}
        >
          <Text bold> Rater Agreement</Text>
          <Box gap={2} marginTop={1}>
            <Box width={20}>
              <Text dimColor>{isSSE ? "Exact" : "Directional"}</Text>
            </Box>
            <Text bold color={agreementColor(data.agreement.percentAgreement)}>
              {data.agreement.percentAgreement.toFixed(1)}%
            </Text>
            <Text dimColor>{data.agreement.pairCount} pairs</Text>
          </Box>
          {data.agreement.kappa > 0 && (
            <Box gap={2} marginTop={1}>
              <Box width={20}>
                <Text dimColor>Weighted Kappa</Text>
              </Box>
              <Text dimColor>
                {data.agreement.kappa.toFixed(3)} ({data.agreement.kappaLabel})
              </Text>
            </Box>
          )}
        </Box>
      )}
    </Box>
  );
}

function SSEDimensionTable({ data }: { data: ResultsData }) {
  const { dimensionSummaries, allDimIds } = data;
  const nameWidth = 20;

  return (
    <Box flexDirection="column">
      <Box gap={0}>
        <Box width={nameWidth}>
          <Text dimColor>Dimension</Text>
        </Box>
        <Box width={8}>
          <Text dimColor>Mean</Text>
        </Box>
        <Box width={8}>
          <Text dimColor>StdDev</Text>
        </Box>
        <Box width={20}>
          <Text dimColor>95% CI</Text>
        </Box>
        <Box width={12}>
          <Text dimColor>Rating</Text>
        </Box>
      </Box>
      <Text dimColor>{"─".repeat(68)}</Text>
      {allDimIds.map((dimId) => {
        const ds = dimensionSummaries.get(dimId);
        if (!ds) return null;
        return (
          <Box key={dimId} gap={0}>
            <Box width={nameWidth}>
              <Text>{(ds.name || dimId).slice(0, nameWidth - 2)}</Text>
            </Box>
            <Box width={8}>
              <Text>{ds.mean.toFixed(2)}</Text>
            </Box>
            <Box width={8}>
              <Text>{ds.stdDev.toFixed(2)}</Text>
            </Box>
            <Box width={20}>
              <Text dimColor>
                [{ds.ci.lower.toFixed(2)}, {ds.ci.upper.toFixed(2)}]
              </Text>
            </Box>
            <Box width={12}>
              <Text
                color={ds.mean >= 4 ? "green" : ds.mean >= 3 ? "yellow" : "red"}
              >
                {ds.qualityLabel ?? "—"}
              </Text>
            </Box>
          </Box>
        );
      })}
    </Box>
  );
}

function SxSDimensionTable({ data }: { data: ResultsData }) {
  const { dimensionSummaries, allDimIds } = data;
  const nameWidth = 18;

  return (
    <Box flexDirection="column">
      <Box gap={0}>
        <Box width={nameWidth}>
          <Text dimColor>Dimension</Text>
        </Box>
        <Box width={8}>
          <Text dimColor>A wins</Text>
        </Box>
        <Box width={8}>
          <Text dimColor>B wins</Text>
        </Box>
        <Box width={6}>
          <Text dimColor>Ties</Text>
        </Box>
        <Box width={8}>
          <Text dimColor>Mean</Text>
        </Box>
        <Box width={20}>
          <Text dimColor>95% CI</Text>
        </Box>
        <Box width={10}>
          <Text dimColor>Winner</Text>
        </Box>
      </Box>
      <Text dimColor>{"─".repeat(78)}</Text>
      {allDimIds.map((dimId) => {
        const ds = dimensionSummaries.get(dimId);
        if (!ds) return null;
        const winnerText =
          ds.winner === "sideA"
            ? "A"
            : ds.winner === "sideB"
              ? "B"
              : ds.winner === "tie"
                ? "Tie"
                : "—";
        const winColor =
          ds.winner === "sideA"
            ? "green"
            : ds.winner === "sideB"
              ? "magenta"
              : "gray";
        return (
          <Box key={dimId} gap={0}>
            <Box width={nameWidth}>
              <Text>{(ds.name || dimId).slice(0, nameWidth - 2)}</Text>
            </Box>
            <Box width={8}>
              <Text color="green">{ds.sideAWins ?? 0}</Text>
            </Box>
            <Box width={8}>
              <Text color="magenta">{ds.sideBWins ?? 0}</Text>
            </Box>
            <Box width={6}>
              <Text>{ds.ties ?? 0}</Text>
            </Box>
            <Box width={8}>
              <Text>
                {ds.mean > 0 ? "+" : ""}
                {ds.mean.toFixed(2)}
              </Text>
            </Box>
            <Box width={20}>
              <Text dimColor>
                [{ds.ci.lower.toFixed(2)}, {ds.ci.upper.toFixed(2)}]
              </Text>
            </Box>
            <Box width={10}>
              <Text bold color={winColor}>
                {winnerText}
              </Text>
            </Box>
          </Box>
        );
      })}
    </Box>
  );
}

function computeOverallStdDev(data: ResultsData): number {
  const stdDevs: number[] = [];
  for (const ds of data.dimensionSummaries.values()) {
    stdDevs.push(ds.stdDev);
  }
  if (stdDevs.length === 0) return 0;
  return stdDevs.reduce((a, b) => a + b, 0) / stdDevs.length;
}

function computeOverallMean(data: ResultsData): number {
  const means: number[] = [];
  for (const ds of data.dimensionSummaries.values()) {
    means.push(ds.mean);
  }
  if (means.length === 0) return 0;
  return means.reduce((a, b) => a + b, 0) / means.length;
}

function computeWinLossRatio(data: ResultsData): string {
  const { sideAWins = 0, sideBWins = 0 } = data.overall;
  if (sideAWins === 0 && sideBWins === 0) return "—";
  const winner = sideAWins >= sideBWins ? sideAWins : sideBWins;
  const loser = sideAWins >= sideBWins ? sideBWins : sideAWins;
  if (loser === 0) return `${winner}:0`;
  return `${(winner / loser).toFixed(1)}:1`;
}
