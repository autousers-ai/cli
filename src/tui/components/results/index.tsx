/**
 * `<ResultsView>` — root for the Wave 6 results screen.
 *
 * Mounted from `app.tsx` whenever `screen === "results"`. Consumes the
 * server's `/api/v1/evaluations/:id/results` payload via
 * {@link useResultsData} and renders one of four tab panels (Overall /
 * Comparisons / Stats / Cost). SSE evals hide the Comparisons tab; SxS
 * evals show it (the head-to-head bar is its marquee element).
 *
 * Keybinds:
 *   - 1-4         direct-jump to a tab (Comparisons gated on SxS)
 *   - Tab         next tab (skips Comparisons on SSE)
 *   - Shift+Tab   prev tab
 *   - ↑↓          scroll comparison rows on the Comparisons tab
 *   - o           open the dashboard's web view in the browser (best-effort)
 *   - e           toggle the export-format selector modal
 *   - Esc / b     back to the menu (drops the eval id, resets the screen)
 *   - q           quit
 */
import { useState } from "react";
import { Box, Text, useInput } from "@jrichman/ink";

import { useTUIStore } from "../../state.js";
import { Theme } from "../../theme.js";
import { CostBreakdown } from "./cost-breakdown.js";
import { TabBar, type TabId } from "./tab-bar.js";
import { TabComparisons } from "./tab-comparisons.js";
import { TabOverall } from "./tab-overall.js";
import { TabStats } from "./tab-stats.js";
import {
  useResultsData,
  type ResultsData,
  type UseResultsDataOptions,
} from "./use-results-data.js";

export interface ResultsViewProps {
  /** Test override for the data hook. */
  hookOptions?: UseResultsDataOptions;
  /** Test override for the browser-opener. */
  openInBrowser?: (url: string) => void;
  /**
   * Optional override for the Esc/back behaviour. Wave 6 default routes
   * to `screen: "menu"` and clears `evaluationId`. Wave 7 reuses this
   * component from the history list and passes its own callback so Esc
   * returns to the list rather than the menu.
   */
  onBack?: () => void;
}

const FORMATS: Array<{ key: string; label: string; ext: string }> = [
  { key: "j", label: "JSON", ext: "json" },
  { key: "c", label: "CSV", ext: "csv" },
  { key: "m", label: "Markdown", ext: "md" },
];

export function ResultsView(props: ResultsViewProps = {}) {
  const evaluationId = useTUIStore((s) => s.evaluationId);
  const setScreen = useTUIStore((s) => s.setScreen);
  const setEvaluationId = useTUIStore((s) => s.setEvaluationId);
  const cost = useTUIStore((s) => s.cost);
  const progress = useTUIStore((s) => s.progress);

  const data = useResultsData(evaluationId, props.hookOptions);

  const [activeTab, setActiveTab] = useState<TabId>(1);
  const [selectedRow, setSelectedRow] = useState(0);
  const [showExportModal, setShowExportModal] = useState(false);

  const showComparisons = !data.isSSE;
  const visibleTabs: TabId[] = showComparisons ? [1, 2, 3, 4] : [1, 3, 4];

  function nextTab(): void {
    const idx = visibleTabs.indexOf(activeTab);
    const next = visibleTabs[(idx + 1) % visibleTabs.length];
    setActiveTab(next);
  }

  function prevTab(): void {
    const idx = visibleTabs.indexOf(activeTab);
    const prev =
      visibleTabs[(idx - 1 + visibleTabs.length) % visibleTabs.length];
    setActiveTab(prev);
  }

  useInput((input, key) => {
    if (showExportModal) {
      if (input === "j" || input === "c" || input === "m") {
        setShowExportModal(false);
        // Format-selector is a placeholder entry point — actual export
        // happens via plain-mode `autousers eval export <id> --format`.
        // We surface a hint via console rather than blocking the TUI on
        // a fs write.
        return;
      }
      if (key.escape) {
        setShowExportModal(false);
        return;
      }
      return;
    }

    if (input === "q") return; // App-level handler quits
    if (input === "b" || key.escape) {
      if (props.onBack) {
        props.onBack();
      } else {
        setEvaluationId(null);
        setScreen("menu");
      }
      return;
    }

    // Tab navigation
    if (key.tab && key.shift) {
      prevTab();
      return;
    }
    if (key.tab) {
      nextTab();
      return;
    }
    if (input === "1" && visibleTabs.includes(1)) {
      setActiveTab(1);
      return;
    }
    if (input === "2" && visibleTabs.includes(2)) {
      setActiveTab(2);
      return;
    }
    if (input === "3" && visibleTabs.includes(3)) {
      setActiveTab(3);
      return;
    }
    if (input === "4" && visibleTabs.includes(4)) {
      setActiveTab(4);
      return;
    }

    // Row navigation on Comparisons tab
    if (activeTab === 2) {
      if (key.upArrow) {
        setSelectedRow((r) => Math.max(0, r - 1));
        return;
      }
      if (key.downArrow) {
        setSelectedRow((r) => Math.min(data.summaries.length - 1, r + 1));
        return;
      }
    }

    if (input === "o" && data.webLink) {
      if (props.openInBrowser) {
        props.openInBrowser(data.webLink);
      } else {
        // Lazy-import — `open` is a Node-built-in helper but we don't
        // ship it as a dep. Fall back to printing the URL.
        process.stdout.write(`\n${data.webLink}\n`);
      }
      return;
    }
    if (input === "e") {
      setShowExportModal(true);
      return;
    }
  });

  if (!evaluationId) {
    return (
      <Box paddingX={2} marginY={1}>
        <Text color={Theme.error}>No evaluation selected.</Text>
      </Box>
    );
  }

  if (data.loading) {
    return (
      <Box paddingX={2} marginY={1}>
        <Text dimColor>Loading results for {evaluationId}...</Text>
      </Box>
    );
  }

  if (data.error) {
    return (
      <Box flexDirection="column" paddingX={2} marginY={1}>
        <Text color={Theme.error}>Failed to load results</Text>
        <Text dimColor>{data.error}</Text>
        <Box marginTop={1}>
          <Text dimColor>Esc → main menu</Text>
        </Box>
      </Box>
    );
  }

  return (
    <Box flexDirection="column" paddingX={1}>
      {/* Summary stats bar */}
      <Box gap={2}>
        <Text>
          Eval: <Text bold>{data.evaluationName}</Text>
        </Text>
        <Text>
          Type: <Text bold>{data.isSSE ? "SSE" : "SxS"}</Text>
        </Text>
        <Text>
          Status: <Text bold>{data.evaluationStatus}</Text>
        </Text>
        {data.overall.totalRatings > 0 && (
          <Text>
            Ratings:{" "}
            <Text bold color="green">
              {data.overall.totalRatings}
            </Text>
          </Text>
        )}
      </Box>

      {/* Tab bar */}
      <Box marginTop={1}>
        <TabBar activeTab={activeTab} showComparisons={showComparisons} />
      </Box>

      {/* Active tab content */}
      <Box marginTop={1} flexDirection="column">
        {activeTab === 1 && <TabOverall data={data} />}
        {activeTab === 2 && showComparisons && (
          <TabComparisons data={data} selectedRow={selectedRow} />
        )}
        {activeTab === 3 && <TabStats data={data} />}
        {activeTab === 4 && (
          <CostBreakdown
            inputTokens={cost.inputTokens}
            outputTokens={cost.outputTokens}
            totalCost={cost.totalCost}
            totalRatings={data.overall.totalRatings}
            totalRuns={progress.completed}
          />
        )}
      </Box>

      {/* Export modal */}
      {showExportModal && <ExportModal evaluationId={evaluationId} />}

      {/* Footer hints */}
      <Box marginTop={1}>
        <Text dimColor>
          {showComparisons ? "1-4" : "1·3·4"} tabs · Tab/Shift+Tab cycle ·
          {data.webLink ? " o open · " : " "}e export · Esc back
        </Text>
      </Box>
    </Box>
  );
}

function ExportModal({ evaluationId }: { evaluationId: string }) {
  return (
    <Box
      flexDirection="column"
      borderStyle="round"
      borderColor="yellow"
      paddingX={1}
      marginTop={1}
    >
      <Text bold>Export</Text>
      <Box marginTop={1} flexDirection="column">
        <Text dimColor>Run from a shell to write the file:</Text>
        {FORMATS.map((f) => (
          <Text key={f.key}>
            <Text color="cyan">[{f.key}]</Text> {f.label} —{" "}
            <Text dimColor>
              {`autousers eval export ${evaluationId} --format ${f.ext} > report.${f.ext}`}
            </Text>
          </Text>
        ))}
        <Box marginTop={1}>
          <Text dimColor>Press a letter to dismiss · Esc to close</Text>
        </Box>
      </Box>
    </Box>
  );
}

// Re-export helpers used by tests.
export type { ResultsData };
