/**
 * Autorater picker for the eval-creation wizard.
 *
 * Adapted from uxrater's `cli/components/interactive/autorater-picker.tsx`,
 * now driven entirely by the server. Earlier waves hardcoded a small
 * `BUILT_IN_AUTOUSERS` list locally; that drifted from the server's
 * actual seed and surfaced fake personas on first real login. The picker
 * now pulls the union of built-in (system) + custom (team-owned)
 * autousers from `GET /api/v1/autousers?includeSystem=true`. The
 * server's `source` field ("built-in" | "custom") drives section
 * rendering.
 *
 * Single-select (not multi-select) to keep the Wave-4 wizard scoped: the
 * server payload accepts an array, but multi-select coupled with the
 * deferred dimension step isn't worth the UX confusion at this stage.
 * The "+ New autouser" row routes to the AI-assisted Wave-8 creator.
 *
 * Keybinds
 * --------
 *   - ↑↓        Navigate between selectable rows (skips section headers)
 *   - Enter     Confirm the highlighted autorater (calls `onSelect`)
 *   - Esc       Step back (calls `onBack`)
 *
 * Loading state: shows "Loading autousers…" while the fetch is in
 * flight. On failure the error is surfaced inline rather than silently
 * swallowed — fake fallback rows would mislead the user about what
 * their team actually has access to.
 */
import { useState, useEffect } from "react";
import { Box, Text, useInput } from "@jrichman/ink";

import { createClientFromConfig } from "../../../client.js";
import { useTUIStore } from "../../state.js";
import { Theme } from "../../theme.js";

/**
 * Single autouser row as the picker uses it. Both built-in and custom
 * rows share this shape; the `source` discriminator tells the renderer
 * which section to slot it under.
 */
export interface PickerAutouser {
  id: string;
  name: string;
  description: string;
  source: "built-in" | "custom";
}

/**
 * The shape `onSelect` receives. Both built-in and custom share this.
 */
export interface PickedAutouser {
  id: string;
  name: string;
  source: "built-in" | "custom";
}

interface AutoraterPickerProps {
  /** Called once the user confirms a selection. */
  onSelect: (autorater: PickedAutouser) => void;
  /** Called when the user presses Esc. */
  onBack: () => void;
  /**
   * Optional override hook for tests — when present, replaces the API
   * fetch entirely. Otherwise the picker pulls every visible autouser
   * from `/api/v1/autousers?includeSystem=true` via the configured CLI
   * client.
   */
  loadAutousers?: () => Promise<PickerAutouser[]>;
}

/**
 * One row in the rendered picker list. Headers are unselectable; both
 * `autorater` and `new-autouser` rows participate in navigation. Wave 8
 * promoted the previously-disabled "+ New autouser" item to a real entry
 * that routes to the autorater-creator screen.
 */
type PickerItem =
  | { kind: "header"; title: string }
  | { kind: "autorater"; autorater: PickerAutouser }
  | { kind: "new-autouser" };

interface AutousersListEnvelope {
  data: Array<{
    id: string;
    name: string;
    description?: string | null;
    isSystem: boolean;
    source?: "built-in" | "custom";
  }>;
  has_more: boolean;
  next_cursor?: string;
}

/**
 * Default loader — used when `loadAutousers` prop isn't supplied.
 * Pulls the union of built-in (system) + custom (team-owned) autousers
 * the caller can see, mapped into the picker's row shape. The server
 * tags each row with `source` directly; we fall back to deriving from
 * `isSystem` for forward-compat with older servers.
 */
async function defaultLoadAutousers(): Promise<PickerAutouser[]> {
  const client = await createClientFromConfig({});
  const env = await client.get<AutousersListEnvelope>(
    "/api/v1/autousers?limit=100&includeSystem=true"
  );
  return env.data.map((row) => ({
    id: row.id,
    name: row.name,
    description: row.description ?? "",
    source: row.source ?? (row.isSystem ? "built-in" : "custom"),
  }));
}

export function AutoraterPicker({
  onSelect,
  onBack,
  loadAutousers,
}: AutoraterPickerProps) {
  const setScreen = useTUIStore((s) => s.setScreen);
  const [autousers, setAutousers] = useState<PickerAutouser[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [selectedIndex, setSelectedIndex] = useState(0);

  useEffect(() => {
    let cancelled = false;
    const fn = loadAutousers ?? defaultLoadAutousers;
    fn()
      .then((rows) => {
        if (cancelled) return;
        setAutousers(rows);
        setLoaded(true);
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        setLoadError(err instanceof Error ? err.message : String(err));
        setLoaded(true);
      });
    return () => {
      cancelled = true;
    };
  }, [loadAutousers]);

  // Partition rows by source so we can render headed sections.
  const builtIn = autousers.filter((a) => a.source === "built-in");
  const custom = autousers.filter((a) => a.source === "custom");

  // Build the flat item list from sections. Headers only render when
  // their section has at least one row — avoids dangling "Built-in"
  // labels for fresh accounts whose seed didn't include built-ins.
  const items: PickerItem[] = [];
  if (builtIn.length > 0) {
    items.push({ kind: "header", title: "Built-in" });
    for (const a of builtIn) {
      items.push({ kind: "autorater", autorater: a });
    }
  }
  if (custom.length > 0) {
    items.push({ kind: "header", title: "Custom" });
    for (const a of custom) {
      items.push({ kind: "autorater", autorater: a });
    }
  }
  // Wave 8 promoted this from a disabled placeholder to a real navigation
  // target — selecting it routes to the autorater-creator screen.
  items.push({ kind: "new-autouser" });

  // Selectable indices skip headers but include the +New row so users can
  // press Enter on it.
  const selectableIndices = items
    .map((it, i) =>
      it.kind === "autorater" || it.kind === "new-autouser" ? i : -1
    )
    .filter((i) => i !== -1);

  // Clamp selectedIndex into the selectable range — the list grows after
  // mount when custom autousers load, so the previous index might land
  // on a header.
  const safeSelectedIndex = Math.min(
    selectedIndex,
    Math.max(0, selectableIndices.length - 1)
  );
  const currentItemIndex = selectableIndices[safeSelectedIndex] ?? 0;

  useInput((_input, key) => {
    if (key.escape) {
      onBack();
      return;
    }
    if (key.upArrow) {
      setSelectedIndex((p) => Math.max(0, p - 1));
      return;
    }
    if (key.downArrow) {
      setSelectedIndex((p) =>
        Math.min(Math.max(0, selectableIndices.length - 1), p + 1)
      );
      return;
    }
    if (key.return) {
      const item = items[currentItemIndex];
      if (item && item.kind === "autorater") {
        onSelect({
          id: item.autorater.id,
          name: item.autorater.name,
          source: item.autorater.source,
        });
      } else if (item && item.kind === "new-autouser") {
        // Route into the AI-assisted creator. The wizard host is
        // responsible for picking up the new autouser id once the
        // creator returns to the picker (it re-fetches the custom
        // list on remount).
        setScreen("autorater-creator");
      }
    }
  });

  return (
    <Box flexDirection="column" paddingX={1}>
      <Box paddingBottom={1}>
        <Text bold color={Theme.brand}>
          Select Autouser
        </Text>
      </Box>

      {!loaded ? (
        <Box paddingBottom={1}>
          <Text dimColor>Loading autousers…</Text>
        </Box>
      ) : null}

      {loaded && loadError ? (
        <Box paddingBottom={1} flexDirection="column">
          <Text color={Theme.error}>Failed to load autousers: {loadError}</Text>
          <Text dimColor>
            Press Esc to go back, or fix your auth and reopen this screen.
          </Text>
        </Box>
      ) : null}

      {loaded && !loadError && autousers.length === 0 ? (
        <Box paddingBottom={1}>
          <Text dimColor>
            No autousers visible. Press Enter on &quot;+ New autouser&quot;
            below to create one.
          </Text>
        </Box>
      ) : null}

      <Box flexDirection="column">
        {items.map((it, i) => {
          if (it.kind === "header") {
            return (
              <Box key={`hdr-${it.title}`} paddingTop={i > 0 ? 1 : 0}>
                <Text dimColor bold>
                  {it.title}
                </Text>
              </Box>
            );
          }
          if (it.kind === "new-autouser") {
            const isCursor = currentItemIndex === i;
            return (
              <Box key="new-autouser" paddingTop={1} gap={1}>
                <Text
                  color={isCursor ? Theme.brand : undefined}
                  bold={isCursor}
                >
                  {isCursor ? ">" : " "}
                </Text>
                <Text
                  color={isCursor ? Theme.brand : undefined}
                  bold={isCursor}
                >
                  + New autouser
                </Text>
                <Text dimColor>(AI-assisted)</Text>
              </Box>
            );
          }
          const isCursor = currentItemIndex === i;
          return (
            <Box key={it.autorater.id} gap={1}>
              <Text color={isCursor ? Theme.brand : undefined} bold={isCursor}>
                {isCursor ? ">" : " "}
              </Text>
              <Text color={isCursor ? Theme.brand : undefined} bold={isCursor}>
                {it.autorater.name}
              </Text>
              {it.autorater.source === "custom" ? (
                <Text dimColor>(custom)</Text>
              ) : null}
            </Box>
          );
        })}
      </Box>

      <Box paddingTop={1}>
        <Text dimColor>↑↓ navigate · Enter select · Esc back</Text>
      </Box>
    </Box>
  );
}
