/**
 * `<TabBar>` — horizontal tab strip for the results screen.
 *
 * Ported from uxrater + extended: uxrater had 3 tabs (Overall /
 * Comparisons / Stats); we add a 4th (Cost) per the Wave 6 brief. SSE
 * evals hide the Comparisons tab via the `showComparisons` prop —
 * single-site eval has no SxS contrast, so the Comparisons head-to-
 * head bar would be empty. Keybinds 1-4 map to the visible tabs in
 * order.
 */
import { Box, Text } from "@jrichman/ink";

export type TabId = 1 | 2 | 3 | 4;

interface TabSpec {
  id: TabId;
  label: string;
}

const SXS_TABS: TabSpec[] = [
  { id: 1, label: "Overall" },
  { id: 2, label: "Comparisons" },
  { id: 3, label: "Stats" },
  { id: 4, label: "Cost" },
];

const SSE_TABS: TabSpec[] = [
  { id: 1, label: "Overall" },
  // SSE skips Comparisons — keybind 2 stays available but routes to nothing
  { id: 3, label: "Stats" },
  { id: 4, label: "Cost" },
];

interface TabBarProps {
  activeTab: TabId;
  showComparisons: boolean;
}

export function TabBar({ activeTab, showComparisons }: TabBarProps) {
  const tabs = showComparisons ? SXS_TABS : SSE_TABS;

  return (
    <Box gap={0}>
      {tabs.map((tab) => {
        const active = tab.id === activeTab;
        return (
          <Box key={tab.id} paddingX={1}>
            <Text
              bold={active}
              color={active ? "blue" : "gray"}
              underline={active}
            >
              {tab.id} {tab.label}
            </Text>
          </Box>
        );
      })}
    </Box>
  );
}
