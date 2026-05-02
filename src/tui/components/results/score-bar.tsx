/**
 * `<ScoreBar>` — horizontal `█`/`░` bar for SSE scores.
 *
 * Ported from uxrater. Color mapping:
 *   - ≥0.7 ratio → green (good)
 *   - ≥0.5 ratio → yellow (mid)
 *   - else → red (poor)
 *
 * `score` is the raw value (e.g. 4.2), `max` the scale ceiling (5 for
 * SSE). Width defaults to 10 cells; bump up for the per-dimension table
 * where there's more horizontal real estate.
 */
import { Box, Text } from "@jrichman/ink";

interface ScoreBarProps {
  score: number;
  max: number;
  width?: number;
}

export function ScoreBar({ score, max, width = 10 }: ScoreBarProps) {
  const ratio = max > 0 ? score / max : 0;
  const filled = Math.round(width * Math.min(1, Math.max(0, ratio)));
  const empty = width - filled;

  let color: string;
  if (ratio >= 0.7) {
    color = "green";
  } else if (ratio >= 0.5) {
    color = "yellow";
  } else {
    color = "red";
  }

  return (
    <Box gap={1}>
      <Text color={color}>{"█".repeat(filled)}</Text>
      <Text dimColor>{"░".repeat(empty)}</Text>
      <Text>
        {score.toFixed(1)}/{max}
      </Text>
    </Box>
  );
}
