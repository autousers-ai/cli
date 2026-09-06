/**
 * Grouped session list — Active → Queued → Completed → Errors.
 *
 * Ported from uxrater with the same grouping logic. The phase labels
 * map 1:1 between local-runner phases and server-shaped phases (queued
 * / navigating / judging / complete / error), so no adaptation
 * necessary beyond importing autousers' SessionState.
 */
import { Box, Text } from "@jrichman/ink";

import type { SessionState } from "../../state.js";
import { SessionRow } from "./session-row.js";

interface SessionListProps {
  sessions: SessionState[];
  verbose?: boolean;
  selectedSessionId?: string | null;
}

export function SessionList({
  sessions,
  verbose = false,
  selectedSessionId,
}: SessionListProps) {
  const active = sessions.filter(
    (s) => s.phase === "navigating" || s.phase === "judging"
  );
  const queued = sessions.filter((s) => s.phase === "queued");
  const completed = sessions.filter((s) => s.phase === "complete");
  const errored = sessions.filter((s) => s.phase === "error");

  return (
    <Box flexDirection="column" gap={0}>
      {active.length > 0 && (
        <Box flexDirection="column">
          <Text bold> Active ({active.length})</Text>
          {active.map((s) => (
            <SessionRow
              key={s.id}
              session={s}
              verbose={verbose}
              selected={selectedSessionId === s.id}
            />
          ))}
        </Box>
      )}

      {queued.length > 0 && (
        <Box flexDirection="column" marginTop={1}>
          <Text dimColor>{"─".repeat(40)}</Text>
          <Text bold dimColor>
            {" "}
            Queued ({queued.length})
          </Text>
          {queued.length <= 3 ? (
            queued.map((s) => (
              <SessionRow
                key={s.id}
                session={s}
                selected={selectedSessionId === s.id}
              />
            ))
          ) : (
            <Box paddingLeft={2}>
              <Text dimColor>
                {queued
                  .slice(0, 2)
                  .map((s) => s.autouserName)
                  .join(", ")}{" "}
                +{queued.length - 2} more
              </Text>
            </Box>
          )}
        </Box>
      )}

      {completed.length > 0 && (
        <Box flexDirection="column" marginTop={1}>
          <Text dimColor>{"─".repeat(40)}</Text>
          <Text bold color="green">
            {" "}
            Completed ({completed.length})
          </Text>
          {completed.slice(-3).map((s) => (
            <SessionRow
              key={s.id}
              session={s}
              verbose={verbose}
              selected={selectedSessionId === s.id}
            />
          ))}
          {completed.length > 3 && (
            <Text dimColor> +{completed.length - 3} more completed</Text>
          )}
        </Box>
      )}

      {errored.length > 0 && (
        <Box flexDirection="column" marginTop={1}>
          <Text dimColor>{"─".repeat(40)}</Text>
          <Text bold color="red">
            {" "}
            Errors ({errored.length})
          </Text>
          {errored.map((s) => (
            <SessionRow
              key={s.id}
              session={s}
              selected={selectedSessionId === s.id}
            />
          ))}
        </Box>
      )}
    </Box>
  );
}
