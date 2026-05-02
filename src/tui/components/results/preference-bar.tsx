/**
 * `<PreferenceBar>` — horizontal SxS preference bar.
 *
 * Renders a "←| ⊥ |→" bar with green-A on the left, magenta-B on the
 * right, the value (-3..+3) and a textual label ("Better A" etc).
 * Ported from uxrater.
 */
import { Box, Text } from "@jrichman/ink";

interface PreferenceBarProps {
  label: string;
  value: number; // -3 to +3
  width?: number;
}

function getSxSLabel(pref: number): string {
  const abs = Math.abs(pref);
  const side = pref < 0 ? "A" : pref > 0 ? "B" : "";
  if (abs === 0) return "Same";
  if (abs < 1) return `Slightly Better ${side}`;
  if (abs < 2) return `Better ${side}`;
  return `Much Better ${side}`;
}

export function PreferenceBar({
  label,
  value,
  width = 10,
}: PreferenceBarProps) {
  const absVal = Math.abs(value);
  const barHalf = width;
  let leftFilled = 0;
  let rightFilled = 0;

  if (value < 0) {
    leftFilled = Math.round((absVal / 3) * barHalf);
  } else if (value > 0) {
    rightFilled = Math.round((absVal / 3) * barHalf);
  }

  const leftBar = "░".repeat(barHalf - leftFilled) + "█".repeat(leftFilled);
  const rightBar = "█".repeat(rightFilled) + "░".repeat(barHalf - rightFilled);

  return (
    <Box gap={1}>
      <Box width={18}>
        <Text>{label}</Text>
      </Box>
      <Text dimColor>A </Text>
      <Text color={value < 0 ? "green" : "gray"}>
        {"◄"}
        {leftBar}
      </Text>
      <Text>{"│"}</Text>
      <Text color={value > 0 ? "green" : "gray"}>
        {rightBar}
        {"►"}
      </Text>
      <Text dimColor> B</Text>
      <Text>
        {" "}
        {value > 0 ? "+" : ""}
        {value.toFixed(1)}
      </Text>
      <Text dimColor> {getSxSLabel(value)}</Text>
    </Box>
  );
}
