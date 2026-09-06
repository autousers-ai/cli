/**
 * Static keybind-hint footer.
 *
 * Single dim line below the body. Wave 3+ may swap this for a context-
 * sensitive variant per screen, but keeping it static for now means the
 * brand-identity layout stays predictable while the menu is wired up.
 *
 * The "Type / for commands" hint is wired through to the slash command
 * palette in `command-palette.tsx`. Pressing `/` from any screen that
 * doesn't already overload the keybind opens the palette overlay.
 */
import { Box, Text } from "@jrichman/ink";

export function Footer() {
  return (
    <Box paddingX={2}>
      <Text dimColor>
        Type / for commands · ↑↓ navigate · Enter select · q to quit
      </Text>
    </Box>
  );
}
