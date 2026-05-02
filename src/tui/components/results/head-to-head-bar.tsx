/**
 * `<HeadToHeadBar>` — stacked `A wins | tied | B wins` distribution bar
 * for SxS aggregate stats. Ported from uxrater.
 */
import { Box, Text } from "@jrichman/ink";

interface HeadToHeadBarProps {
  sideAWins: number;
  sideBWins: number;
  ties: number;
  width?: number;
}

export function HeadToHeadBar({
  sideAWins,
  sideBWins,
  ties,
  width = 40,
}: HeadToHeadBarProps) {
  const total = sideAWins + sideBWins + ties;
  if (total === 0) {
    return (
      <Box>
        <Text dimColor>No ratings yet</Text>
      </Box>
    );
  }

  const aPct = (sideAWins / total) * 100;
  const bPct = (sideBWins / total) * 100;
  const tPct = (ties / total) * 100;

  const aWidth = Math.round((sideAWins / total) * width);
  const bWidth = Math.round((sideBWins / total) * width);
  const tWidth = Math.max(0, width - aWidth - bWidth);

  return (
    <Box flexDirection="column">
      <Box gap={0}>
        {aWidth > 0 && (
          <Text color="green" bold>
            {"█".repeat(aWidth)}
          </Text>
        )}
        {tWidth > 0 && <Text color="gray">{"░".repeat(tWidth)}</Text>}
        {bWidth > 0 && (
          <Text color="magenta" bold>
            {"█".repeat(bWidth)}
          </Text>
        )}
      </Box>
      <Box gap={2}>
        <Text color="green">A wins {aPct.toFixed(0)}%</Text>
        <Text dimColor>Tied {tPct.toFixed(0)}%</Text>
        <Text color="magenta">B wins {bPct.toFixed(0)}%</Text>
      </Box>
    </Box>
  );
}
