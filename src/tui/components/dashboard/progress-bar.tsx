/**
 * Compact N/M progress bar with ETA estimate.
 *
 * Ported from uxrater's `cli/components/dashboard/progress-bar.tsx`,
 * trimmed of the local-runner-specific styling. Render is unchanged
 * — same Unicode block characters, same colour ramp.
 */
import { memo } from "react";
import { Box, Text } from "@jrichman/ink";

interface ProgressBarProps {
  completed: number;
  total: number;
  label?: string;
  /** ms-since-epoch start time; enables an "~Xs left" estimate. */
  startedAt?: number | null;
}

export const ProgressBar = memo(function ProgressBar({
  completed,
  total,
  label = "Overall",
  startedAt,
}: ProgressBarProps) {
  const ratio = total > 0 ? completed / total : 0;
  const percent = Math.round(ratio * 100);

  let color: string;
  if (ratio >= 0.7) color = "green";
  else if (ratio >= 0.4) color = "yellow";
  else color = "red";

  const barWidth = 40;
  const filled = Math.round(barWidth * ratio);
  const empty = barWidth - filled;
  const filledStr = "█".repeat(filled);
  const emptyStr = "░".repeat(empty);

  let eta = "";
  if (startedAt && completed > 0 && completed < total) {
    const elapsedMs = Date.now() - startedAt;
    const msPerItem = elapsedMs / completed;
    const remainingMs = msPerItem * (total - completed);
    const remainingSec = Math.round(remainingMs / 1000);
    if (remainingSec >= 60) {
      eta = `~${Math.floor(remainingSec / 60)}m ${remainingSec % 60}s left`;
    } else {
      eta = `~${remainingSec}s left`;
    }
  }

  return (
    <Box gap={1}>
      <Text>{label}: </Text>
      <Text color={color}>{filledStr}</Text>
      <Text dimColor>{emptyStr}</Text>
      <Text>
        {" "}
        {completed}/{total}
      </Text>
      <Text dimColor> {percent}%</Text>
      {eta && <Text dimColor> {eta}</Text>}
    </Box>
  );
});
