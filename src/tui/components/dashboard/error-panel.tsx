/**
 * Collapsible error panel.
 *
 * Ported from uxrater. `e` toggles expand/collapse. Reads errors out of
 * the parent rather than the store so the parent can apply filtering
 * (e.g. dedupe stream-level synthetic errors).
 */
import { useState } from "react";
import { Box, Text, useInput } from "@jrichman/ink";

interface ErrorPanelProps {
  errors: { sessionId: string; message: string }[];
}

export function ErrorPanel({ errors }: ErrorPanelProps) {
  const [expanded, setExpanded] = useState(false);

  useInput((input) => {
    if (input === "e") setExpanded((prev) => !prev);
  });

  if (errors.length === 0) return null;

  return (
    <Box
      flexDirection="column"
      borderStyle="single"
      borderColor="red"
      paddingX={1}
    >
      <Box gap={1}>
        <Text color="red" bold>
          Errors ({errors.length})
        </Text>
        <Text dimColor>{expanded ? "[collapse]" : "[expand · e]"}</Text>
      </Box>
      {expanded ? (
        errors.map((err, i) => (
          <Box key={i} gap={1}>
            <Text color="red">✘</Text>
            <Text dimColor>{err.sessionId.slice(0, 8)}…:</Text>
            <Text color="red">{err.message}</Text>
          </Box>
        ))
      ) : (
        <Text color="red">
          {errors[0]!.message.slice(0, 80)}
          {errors.length > 1 ? ` (+${errors.length - 1} more)` : ""}
        </Text>
      )}
    </Box>
  );
}
