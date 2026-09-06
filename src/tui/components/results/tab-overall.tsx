/**
 * Overall tab — top-level summary for an evaluation.
 *
 * SSE: overall avg score banner + per-dimension score bars.
 * SxS: winner banner + head-to-head bar + per-dimension preference bars.
 *
 * Adapted from uxrater. The server already computes overall winner /
 * confidence / win rate, so the rendering is mostly straight reads from
 * `data.overall` rather than rolling our own math like uxrater did.
 */
import { Box, Text } from "@jrichman/ink";

import { HeadToHeadBar } from "./head-to-head-bar.js";
import { MetricCards, type MetricCard } from "./metric-cards.js";
import { PreferenceBar } from "./preference-bar.js";
import { ScoreBar } from "./score-bar.js";
import type { ResultsData } from "./use-results-data.js";

interface TabOverallProps {
  data: ResultsData;
}

function scoreColor(score: number, max: number): string {
  const ratio = score / max;
  if (ratio >= 0.8) return "green";
  if (ratio >= 0.6) return "yellow";
  if (ratio >= 0.4) return "white";
  return "red";
}

function qualityLabel(score: number, max: number): string {
  const ratio = score / max;
  if (ratio >= 0.9) return "Excellent";
  if (ratio >= 0.7) return "Very Good";
  if (ratio >= 0.5) return "Good";
  if (ratio >= 0.3) return "Fair";
  return "Poor";
}

/**
 * Green/yellow/white/red for a direct-count agreement percentage.
 *
 * WAS 80/60/40 FOR EVERYTHING. Those boundaries were tuned when the server's
 * agreement field was a kappa remapped by `((k+1)/2)*100`, where 50% meant
 * chance. It is now the raw share of items on which two raters gave the same
 * score, whose chance floor is 1/k on a k-point scale.
 *
 * TWO TABLES, because that floor differs. An SSE score on the 5-point default
 * matches 20% of the time by luck, giving 85 / 70 / 50. SxS agreement is
 * DIRECTIONAL — which side won — so there are three outcomes, the floor is
 * ~33%, and the same percentage is weaker evidence: the boundaries rise to
 * 90 / 75 / 60. Reusing the SSE numbers on SxS colours a percentage greener
 * than it has earned, which is the one direction a reliability threshold must
 * not err in.
 *
 * Mirrors lib/agreement-bands.ts in the web app, which shows the arithmetic;
 * duplicated rather than imported because the CLI ships as its own package and
 * does not depend on the Next monorepo's modules.
 */
function agreementColor(pct: number, isSSE: boolean): string {
  const [strong, clear, mixed] = isSSE ? [85, 70, 50] : [90, 75, 60];
  if (pct >= strong) return "green";
  if (pct >= clear) return "yellow";
  if (pct >= mixed) return "white";
  return "red";
}

export function TabOverall({ data }: TabOverallProps) {
  if (data.isSSE) {
    return <SSEOverall data={data} />;
  }
  return <SxSOverall data={data} />;
}

function SxSOverall({ data }: TabOverallProps) {
  const { overall, dimensionSummaries, allDimIds, sideALabel, sideBLabel } =
    data;

  const winnerLabel =
    overall.overallWinner === "sideA"
      ? sideALabel || "Side A"
      : overall.overallWinner === "sideB"
        ? sideBLabel || "Side B"
        : overall.overallWinner === "tie"
          ? "Tied"
          : "Inconclusive";

  const winnerColor =
    overall.overallWinner === "sideA"
      ? "green"
      : overall.overallWinner === "sideB"
        ? "magenta"
        : "yellow";

  const cards: MetricCard[] = [
    {
      label: "Win Rate",
      value: `${(overall.winRate ?? 50).toFixed(0)}%`,
      color: "green",
    },
    {
      label: "Confidence",
      value: overall.confidence ?? "—",
      color:
        overall.confidence === "High"
          ? "green"
          : overall.confidence === "Medium"
            ? "yellow"
            : "red",
    },
    { label: "Total Ratings", value: String(overall.totalRatings) },
    { label: "Comparisons", value: String(overall.totalComparisons) },
    ...(data.agreement && data.agreement.pairCount > 0
      ? [
          {
            label: "Agreement",
            value: `${data.agreement.percentAgreement.toFixed(0)}%`,
            color: agreementColor(data.agreement.percentAgreement, data.isSSE),
          } as MetricCard,
        ]
      : []),
  ];

  return (
    <Box flexDirection="column" gap={1}>
      <Box
        borderStyle="round"
        borderColor={winnerColor}
        paddingX={2}
        justifyContent="center"
      >
        <Text color={winnerColor} bold>
          {"✔"} Winner: {winnerLabel}
        </Text>
      </Box>

      <HeadToHeadBar
        sideAWins={overall.sideAWins ?? 0}
        sideBWins={overall.sideBWins ?? 0}
        ties={overall.ties ?? 0}
      />

      <MetricCards cards={cards} />

      {allDimIds.length > 0 && (
        <Box
          flexDirection="column"
          borderStyle="single"
          borderColor="gray"
          paddingX={1}
        >
          <Text bold> Dimension Preferences</Text>
          {allDimIds.map((dimId) => {
            const ds = dimensionSummaries.get(dimId);
            if (!ds) return null;
            return (
              <PreferenceBar
                key={dimId}
                label={ds.name || dimId}
                value={ds.mean}
              />
            );
          })}
        </Box>
      )}
    </Box>
  );
}

function SSEOverall({ data }: TabOverallProps) {
  const { overall, dimensionSummaries, allDimIds } = data;
  const avg = overall.overallAvg ?? 0;

  const cards: MetricCard[] = [
    {
      label: "Avg Score",
      value: `${avg.toFixed(1)}/5`,
      color: scoreColor(avg, 5),
    },
    {
      label: "Confidence",
      value: overall.confidence ?? "—",
      color:
        overall.confidence === "High"
          ? "green"
          : overall.confidence === "Medium"
            ? "yellow"
            : "red",
    },
    { label: "Total Ratings", value: String(overall.totalRatings) },
    { label: "Designs", value: String(overall.totalComparisons) },
    ...(data.agreement && data.agreement.pairCount > 0
      ? [
          {
            label: "Agreement",
            value: `${data.agreement.percentAgreement.toFixed(0)}%`,
            color: agreementColor(data.agreement.percentAgreement, data.isSSE),
          } as MetricCard,
        ]
      : []),
  ];

  return (
    <Box flexDirection="column" gap={1}>
      <Box
        borderStyle="round"
        borderColor={scoreColor(avg, 5)}
        paddingX={2}
        justifyContent="center"
        gap={2}
      >
        <Text bold>Overall Score</Text>
        <ScoreBar score={avg} max={5} width={20} />
        <Text color={scoreColor(avg, 5)}>{qualityLabel(avg, 5)}</Text>
      </Box>

      <MetricCards cards={cards} />

      {allDimIds.length > 0 && (
        <Box
          flexDirection="column"
          borderStyle="single"
          borderColor="gray"
          paddingX={1}
        >
          <Text bold> Dimension Scores</Text>
          {allDimIds.map((dimId) => {
            const ds = dimensionSummaries.get(dimId);
            if (!ds) return null;
            return (
              <Box key={dimId} gap={2}>
                <Box width={22}>
                  <Text>{ds.name || dimId}</Text>
                </Box>
                <ScoreBar score={ds.mean} max={5} />
                <Text color={scoreColor(ds.mean, 5)}>
                  {ds.qualityLabel ?? qualityLabel(ds.mean, 5)}
                </Text>
              </Box>
            );
          })}
        </Box>
      )}
    </Box>
  );
}
