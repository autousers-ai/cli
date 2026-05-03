/**
 * `<CostBreakdown>` — total spend + token breakdown for the Cost tab.
 *
 * Adapted from uxrater. The big delta: uxrater split nav-tokens vs
 * judging-tokens; the autousers server only exposes a single combined
 * `inputTokens`/`outputTokens` per run, so we render one bucket. If the
 * server ever splits per-phase, widen the props here and render two
 * rows.
 *
 * Currency formatting matches the dashboard's `cost-ticker` — `$X.XXXX`
 * for sub-cent totals, `$X.XX` otherwise.
 */
import { Box, Text } from "@jrichman/ink";

interface CostBreakdownProps {
  inputTokens: number;
  outputTokens: number;
  totalCost: number;
  totalRatings: number;
  totalRuns: number;
}

function formatCost(usd: number): string {
  if (usd === 0) return "$0.00";
  if (usd < 0.01) return `$${usd.toFixed(4)}`;
  return `$${usd.toFixed(2)}`;
}

function formatTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return String(n);
}

export function CostBreakdown({
  inputTokens,
  outputTokens,
  totalCost,
  totalRatings,
  totalRuns,
}: CostBreakdownProps) {
  const totalTokens = inputTokens + outputTokens;
  const costPerRating = totalRatings > 0 ? totalCost / totalRatings : 0;

  return (
    <Box
      flexDirection="column"
      borderStyle="single"
      borderColor="gray"
      paddingX={1}
    >
      <Text bold> Cost Breakdown</Text>
      <Box justifyContent="space-between">
        <Text>
          Tokens{" "}
          <Text dimColor>
            {formatTokens(inputTokens)} input + {formatTokens(outputTokens)}{" "}
            output
          </Text>
        </Text>
        <Text dimColor>{formatTokens(totalTokens)} total</Text>
      </Box>
      <Box justifyContent="space-between">
        <Text>
          Runs <Text dimColor>{totalRuns} completed</Text>
        </Text>
        <Text dimColor>{totalRatings} ratings produced</Text>
      </Box>
      <Text dimColor>{"─".repeat(60)}</Text>
      <Box justifyContent="space-between">
        <Text bold>Total</Text>
        <Text color="blueBright" bold>
          {formatCost(totalCost)}
        </Text>
      </Box>
      {totalRatings > 0 && (
        <Box justifyContent="space-between">
          <Text dimColor>Per rating</Text>
          <Text dimColor>{formatCost(costPerRating)}</Text>
        </Box>
      )}
    </Box>
  );
}
