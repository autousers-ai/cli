/**
 * Animated $X.XX cost ticker.
 *
 * Adapted from uxrater's `cost-ticker.tsx`, simplified:
 * uxrater split nav vs. judging tokens because its local runner had
 * separate Gemini calls for each phase. The autousers server only
 * exposes a single combined `inputTokens`/`outputTokens` per run, so
 * this ticker shows total spend + tokens + ~$/comparison only.
 */
import { memo } from "react";
import { Box, Text } from "@jrichman/ink";

import { Theme } from "../../theme.js";

interface CostTickerProps {
  inputTokens: number;
  outputTokens: number;
  totalCost: number;
  completedCount: number;
}

function formatCost(cost: number): string {
  if (!Number.isFinite(cost) || cost === 0) return "$0.00";
  if (cost < 0.01) return `$${cost.toFixed(4)}`;
  return `$${cost.toFixed(2)}`;
}

function formatTokens(tokens: number): string {
  if (tokens >= 1_000_000) return `${(tokens / 1_000_000).toFixed(1)}M`;
  if (tokens >= 1_000) return `${(tokens / 1_000).toFixed(1)}K`;
  return String(tokens);
}

export const CostTicker = memo(function CostTicker({
  inputTokens,
  outputTokens,
  totalCost,
  completedCount,
}: CostTickerProps) {
  const perComparison = completedCount > 0 ? totalCost / completedCount : 0;

  return (
    <Box
      flexDirection="column"
      borderStyle="single"
      borderColor="gray"
      paddingX={1}
      width={26}
    >
      <Text bold> Cost</Text>
      <Box justifyContent="space-between">
        <Text dimColor>Input:</Text>
        <Text dimColor>{formatTokens(inputTokens)} tok</Text>
      </Box>
      <Box justifyContent="space-between">
        <Text dimColor>Output:</Text>
        <Text dimColor>{formatTokens(outputTokens)} tok</Text>
      </Box>
      <Text dimColor>{"─".repeat(20)}</Text>
      <Box justifyContent="space-between">
        <Text bold>Total:</Text>
        <Text color={Theme.brand} bold>
          {formatCost(totalCost)}
        </Text>
      </Box>
      {perComparison > 0 && (
        <Box marginTop={1}>
          <Text dimColor>~{formatCost(perComparison)}/run</Text>
        </Box>
      )}
    </Box>
  );
});
