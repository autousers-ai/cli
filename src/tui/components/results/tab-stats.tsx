/**
 * Stats tab — distribution chart + per-dimension breakdown table +
 * agreement metrics. Adapted from uxrater.
 */
import { Box, Text } from "@jrichman/ink";

import { DistributionChart } from "./distribution-chart.js";
import { MetricCards, type MetricCard } from "./metric-cards.js";
import { excludedRatingLines, type ResultsData } from "./use-results-data.js";

interface TabStatsProps {
  data: ResultsData;
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

export function TabStats({ data }: TabStatsProps) {
  const { isSSE, overall, distribution, allDimIds } = data;

  // `overall.totalRatings` is the USABLE count — the server already subtracted
  // every rating it held out. Printing it alone said "Ratings 8" on an
  // evaluation the user launched with ten, and the two blocked scrapes that
  // account for the gap were the one fact that would have told them to turn
  // the proxy on. So the card carries both numbers and the reasons follow it.
  const excluded = overall.excluded;
  const attempted = overall.totalRatings + excluded.total;
  const ratingsValue =
    excluded.total > 0
      ? `${overall.totalRatings} of ${attempted}`
      : String(overall.totalRatings);
  const exclusionLines = excludedRatingLines(excluded);

  const cards: MetricCard[] = isSSE
    ? [
        { label: "Designs", value: String(overall.totalComparisons) },
        { label: "Ratings", value: ratingsValue },
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
        { label: "Ratings", value: ratingsValue },
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

      {/* Directly under the count it modifies, and with the remedy attached —
          a count without a remedy sends people to guess. Absent entirely on a
          healthy evaluation. */}
      {exclusionLines.length > 0 && (
        <Box flexDirection="column" paddingX={1}>
          <Text color="yellow">
            {excluded.total} of {attempted} ratings excluded from every figure
            below
          </Text>
          {exclusionLines.map((line) => (
            <Text key={line} dimColor>
              {"  "}
              {line}
            </Text>
          ))}
        </Box>
      )}

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
            <Text
              bold
              color={agreementColor(
                data.agreement.percentAgreement,
                data.isSSE
              )}
            >
              {data.agreement.percentAgreement.toFixed(1)}%
            </Text>
            <Text dimColor>{data.agreement.pairCount} pairs</Text>
          </Box>
          {/* The server sends the UNWEIGHTED overall kappa here; this row said
              "Weighted Kappa", which named a statistic the payload does not
              carry. It is usually a weighted MEAN of several kappas — one per
              rater pair, one per scale group — and a mean of kappas is not a
              kappa, so the label says which of the two it is. Gated on `!==
              null` rather than `> 0`: a negative kappa is a real result
              (raters agreeing less than chance) and hiding it read as "no
              kappa", while a null means kappa is undefined. */}
          {data.agreement.kappa !== null && (
            <Box gap={2} marginTop={1}>
              <Box width={20}>
                <Text dimColor>
                  {data.agreement.kappaIsMean ? "Mean Kappa" : "Cohen's Kappa"}
                </Text>
              </Box>
              <Text dimColor>
                {data.agreement.kappa.toFixed(3)} ({data.agreement.kappaLabel})
              </Text>
            </Box>
          )}
          {/* Beside the figures it changed. Silence here is what let a kappa
              jump from 0.31 to 0.93 between two runs of this command with
              nothing on screen to say a cancelled run had stopped counting. */}
          {data.agreement.withdrawnRaters > 0 && (
            <Box gap={2} marginTop={1}>
              <Box width={20}>
                <Text dimColor>Raters excluded</Text>
              </Box>
              <Text color="yellow">
                {data.agreement.withdrawnRaters} (run did not finish)
              </Text>
            </Box>
          )}
          {/* The raters that were KEPT while covering less than the whole
              evaluation. A large evaluation is split across pods and those
              runs are one rater, so a failed chunk shortens a rater instead of
              withdrawing it — it stays in the count above at two thirds the
              coverage of the rater beside it. Saying nothing here is what
              would make the rater count read as a count of equal peers. */}
          {data.agreement.partialRaters > 0 && (
            <Box gap={2} marginTop={1}>
              <Box width={20}>
                <Text dimColor>Partial coverage</Text>
              </Box>
              <Text color="yellow">
                {data.agreement.partialRaters}
                {data.agreement.partialLowestCoverage
                  ? ` (lowest: ${data.agreement.partialLowestCoverage[0]} of ${data.agreement.partialLowestCoverage[1]} designs)`
                  : " (rated part of the evaluation)"}
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
