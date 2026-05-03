/**
 * Generic modal box for the TUI.
 *
 * Ported from uxrater's `cli/components/interactive/modal.tsx`. Used by
 * Wave 3 (logout confirmation, login status), Wave 4+ (wizard step
 * containers), Wave 7 (share / invite / transfer dialogs).
 *
 * Single bold border, brand-blue title row, optional footer separated by
 * a divider rule. No internal interactivity — the parent owns key
 * handling and rendering decisions; this component is a pure layout
 * primitive.
 */
import type { ReactNode } from "react";
import { Box, Text } from "@jrichman/ink";

import { Theme } from "../../theme.js";

interface ModalProps {
  /** Title shown in the top-left, in the same color as the border. */
  title: string;
  /** Body content. Caller controls layout inside. */
  children: ReactNode;
  /** Optional footer (e.g. keybind hints). Rendered below a divider. */
  footer?: ReactNode;
  /** Fixed width. Caller picks something the terminal will fit. */
  width?: number;
  /**
   * Border + title color. Defaults to the brand blue. Pick `Theme.error`
   * for destructive confirmations, `Theme.warning` for "are you sure"
   * dialogs, etc.
   */
  borderColor?: string;
}

export function Modal({
  title,
  children,
  footer,
  width = 60,
  borderColor = Theme.brand,
}: ModalProps) {
  return (
    <Box flexDirection="column" width={width}>
      <Box
        borderStyle="bold"
        borderColor={borderColor}
        flexDirection="column"
        paddingX={1}
        paddingY={1}
      >
        <Box paddingBottom={1}>
          <Text bold color={borderColor}>
            {title}
          </Text>
        </Box>
        <Box flexDirection="column">{children}</Box>
        {footer && (
          <Box paddingTop={1} borderStyle="single" borderTop>
            {footer}
          </Box>
        )}
      </Box>
    </Box>
  );
}
