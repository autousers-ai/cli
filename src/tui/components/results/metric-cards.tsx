/**
 * `<MetricCards>` — row of bordered key/value cards. Ported from uxrater.
 *
 * Used at the top of every results tab to surface summary numbers
 * (Win Rate, Confidence, Total Ratings, etc.) in a compact, scannable
 * format.
 */
import { Box, Text } from "@jrichman/ink";

export interface MetricCard {
  label: string;
  value: string;
  color?: string;
}

interface MetricCardsProps {
  cards: MetricCard[];
}

export function MetricCards({ cards }: MetricCardsProps) {
  return (
    <Box gap={2}>
      {cards.map((card) => (
        <Box
          key={card.label}
          flexDirection="column"
          borderStyle="single"
          borderColor="gray"
          paddingX={1}
          minWidth={14}
        >
          <Text dimColor>{card.label}</Text>
          <Text bold color={card.color ?? undefined}>
            {card.value}
          </Text>
        </Box>
      ))}
    </Box>
  );
}
