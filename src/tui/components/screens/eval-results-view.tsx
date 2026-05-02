/**
 * Wave 7 — eval-results-view (results screen entered from history).
 *
 * Thin wrapper around Wave 6's {@link ResultsView}. The two screens
 * differ only in their entry / exit behaviour:
 *
 *   - Wave 6's `<ResultsView>` lives at `screen === "results"`. It's
 *     auto-mounted by the dashboard when a live run hits `done`, reads
 *     `evaluationId` from the store, and Esc returns to the menu.
 *
 *   - This screen lives at `screen === "eval-results-by-id"`. It's
 *     mounted by the user pressing Enter on a row in
 *     {@link EvalHistory}, reads `selectedEvalId` from the store, and
 *     Esc returns to the history list rather than the menu.
 *
 * To avoid duplicating any of the tabbed-results logic, this component
 * mirrors `selectedEvalId` → `evaluationId` on mount, then renders
 * `<ResultsView>` with an `onBack` callback that routes to the history
 * list. ResultsView's `onBack` prop (added in Wave 7) defers to this
 * callback when present, otherwise falls back to its Wave-6 behaviour.
 */
import { useEffect } from "react";
import { Box, Text } from "@jrichman/ink";

import { useTUIStore } from "../../state.js";
import { Theme } from "../../theme.js";
import { ResultsView } from "../results/index.js";

export function EvalResultsView() {
  const selectedEvalId = useTUIStore((s) => s.selectedEvalId);
  const evaluationId = useTUIStore((s) => s.evaluationId);
  const setEvaluationId = useTUIStore((s) => s.setEvaluationId);
  const setScreen = useTUIStore((s) => s.setScreen);

  // Mirror selectedEvalId → evaluationId so ResultsView's hook fetches
  // the right resource. The mirror happens before the first render of
  // ResultsView so the hook never fires for the wrong id.
  useEffect(() => {
    if (selectedEvalId && selectedEvalId !== evaluationId) {
      setEvaluationId(selectedEvalId);
    }
  }, [selectedEvalId, evaluationId, setEvaluationId]);

  if (!selectedEvalId) {
    return (
      <Box paddingX={2} marginY={1}>
        <Text color={Theme.error}>No evaluation selected.</Text>
        <Text dimColor>Esc → back to history</Text>
      </Box>
    );
  }

  return <ResultsView onBack={() => setScreen("eval-history")} />;
}
