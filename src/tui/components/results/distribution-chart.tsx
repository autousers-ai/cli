/**
 * `<DistributionChart>` — vertical-label / horizontal-bar histogram for
 * SSE 1-5 or SxS -3..+3 rating distributions. Ported from uxrater.
 */
import { Box, Text } from "@jrichman/ink";
import type { RatingDistribution } from "./use-results-data.js";

interface DistributionChartProps {
  data: RatingDistribution[];
  maxBarWidth?: number;
  isSSE: boolean;
}

function barColor(value: number, isSSE: boolean): string {
  if (isSSE) {
    if (value >= 4) return "green";
    if (value >= 3) return "yellow";
    return "red";
  }
  // SxS: positive = B, negative = A, 0 = tie
  if (value > 0) return "magenta";
  if (value < 0) return "green";
  return "gray";
}

function valueLabel(value: number, isSSE: boolean): string {
  if (isSSE) {
    const labels: Record<number, string> = {
      1: "1 Poor",
      2: "2 Fair",
      3: "3 Good",
      4: "4 Very Good",
      5: "5 Excellent",
    };
    return (labels[value] || String(value)).padEnd(14);
  }
  const labels: Record<number, string> = {
    [-3]: "-3 Much Better A",
    [-2]: "-2 Better A",
    [-1]: "-1 Slightly A",
    [0]: " 0 Same",
    [1]: "+1 Slightly B",
    [2]: "+2 Better B",
    [3]: "+3 Much Better B",
  };
  return (labels[value] ?? String(value)).padEnd(18);
}

export function DistributionChart({
  data,
  maxBarWidth = 30,
  isSSE,
}: DistributionChartProps) {
  const maxCount = Math.max(...data.map((d) => d.count), 1);

  return (
    <Box flexDirection="column">
      {data.map((item) => {
        const barLen = Math.round((item.count / maxCount) * maxBarWidth);
        return (
          <Box key={item.value} gap={1}>
            <Text>{valueLabel(item.value, isSSE)}</Text>
            <Text color={barColor(item.value, isSSE)}>
              {"█".repeat(barLen)}
            </Text>
            <Text dimColor>
              {item.count} ({item.pct.toFixed(0)}%)
            </Text>
          </Box>
        );
      })}
    </Box>
  );
}
