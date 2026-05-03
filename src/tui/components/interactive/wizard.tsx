/**
 * Generic multi-step wizard chrome.
 *
 * Ported from uxrater's `cli/components/interactive/wizard.tsx`, but
 * decoupled from any specific flow's state shape — the original was tied
 * directly to evaluation creation. Future waves (autouser creator in
 * Wave 8, template creator in Wave 9) reuse this same chrome by passing
 * a different `steps` array.
 *
 * Layout
 * ------
 * On wide terminals (>= 100 cols) renders a sidebar on the left with the
 * step list (checked / current / pending) plus an optional preview line
 * under each completed step. On narrow terminals collapses to a single
 * breadcrumb line above the body content. The body itself is whatever
 * the host screen passes via `children` — the wizard is a pure layout
 * primitive; it doesn't drive state transitions.
 *
 * Keybinds
 * --------
 * No keybinds are owned by the wizard itself. Each step component owns
 * its own input handling (useInput in the body), and forward / back is
 * driven by callbacks the host screen wires up. Centralizing keybinds
 * in the wizard would couple every step to the same shape; pushing them
 * into the steps lets each one tailor (URL fields swallow `q`, picker
 * lists eat ↑↓, review uses ←→, etc.) without leaking those concerns up.
 */
import type { ReactNode } from "react";
import { Fragment } from "react";
import { Box, Text } from "@jrichman/ink";

import { Theme } from "../../theme.js";
import { isWideTerminal } from "../../tty.js";

/**
 * One row in the wizard's step list. `key` is the stable identifier; the
 * host screen tracks the active step by key. `label` is what the user
 * sees in the sidebar / breadcrumb. `preview` is the dim summary line
 * shown under a completed step (e.g. "3 dimensions" once that step is
 * past) — falsy values render no preview line.
 */
export interface WizardStep {
  key: string;
  label: string;
  preview?: string;
}

interface WizardProps {
  /**
   * The complete step list. The active step is the one whose `key`
   * matches `activeKey`; everything before it renders as completed
   * (green check), everything after renders as pending (gray bracket).
   */
  steps: WizardStep[];
  /** Active step's `key`. */
  activeKey: string;
  /**
   * Optional title above the step list. Defaults to the empty string
   * (no title row); useful for branding the sidebar with a short flow
   * name like "Create Evaluation".
   */
  title?: string;
  /** Body content rendered to the right of (or below) the step list. */
  children: ReactNode;
  /**
   * Optional extra content rendered at the bottom of the sidebar. Wave
   * 4 uses this for the live cost-estimate card; future waves can drop
   * any persistent contextual element here without bloating the wizard.
   */
  sidebarFooter?: ReactNode;
}

/**
 * Render a wizard step list + body. Pure layout — no state, no input
 * handling. The host screen drives `activeKey` based on its own state
 * machine and passes `children` for the active step's body.
 */
export function Wizard({
  steps,
  activeKey,
  title,
  children,
  sidebarFooter,
}: WizardProps) {
  const wide = isWideTerminal();
  const stepIndex = Math.max(
    0,
    steps.findIndex((s) => s.key === activeKey)
  );

  return (
    <Box flexDirection="row">
      {wide && (
        <Box
          flexDirection="column"
          paddingX={1}
          paddingY={1}
          borderStyle="single"
          borderColor={Theme.textDim}
          width={26}
        >
          {title ? (
            <Text bold color={Theme.brand}>
              {title}
            </Text>
          ) : null}
          <Box flexDirection="column" paddingTop={title ? 1 : 0}>
            {steps.map((s, i) => {
              const state =
                i === stepIndex
                  ? "active"
                  : i < stepIndex
                    ? "complete"
                    : "pending";
              const color =
                state === "active"
                  ? Theme.brand
                  : state === "complete"
                    ? Theme.success
                    : Theme.textDim;
              const marker =
                state === "complete"
                  ? "[x]"
                  : state === "active"
                    ? "[>]"
                    : "[ ]";
              return (
                <Box key={s.key} flexDirection="column">
                  <Box gap={1}>
                    <Text color={color}>{marker}</Text>
                    <Text color={color} bold={state === "active"}>
                      {s.label}
                    </Text>
                  </Box>
                  {state === "complete" && s.preview ? (
                    <Box paddingLeft={4}>
                      <Text dimColor>{s.preview}</Text>
                    </Box>
                  ) : null}
                </Box>
              );
            })}
          </Box>
          {sidebarFooter ? <Box marginTop={1}>{sidebarFooter}</Box> : null}
        </Box>
      )}

      <Box flexDirection="column" flexGrow={1}>
        {!wide && (
          <Box paddingX={1} paddingBottom={1}>
            {steps.map((s, i) => {
              const color =
                i === stepIndex
                  ? Theme.brand
                  : i < stepIndex
                    ? Theme.success
                    : Theme.textDim;
              return (
                <Fragment key={s.key}>
                  {i > 0 && <Text dimColor> {">"} </Text>}
                  <Text color={color} bold={i === stepIndex}>
                    {s.label}
                  </Text>
                </Fragment>
              );
            })}
          </Box>
        )}
        {children}
      </Box>
    </Box>
  );
}
