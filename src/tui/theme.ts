/**
 * Color tokens for the autousers CLI's Ink-based TUI.
 *
 * Defined once here, consumed by every screen and component. No inline
 * hex values anywhere else — keeps the brand consistent and makes a
 * future light/dark/high-contrast switch a one-file change.
 *
 * The brand blue is `#7fc8ff` — a high-luminance sky blue that meets
 * WCAG AA contrast against the typical dark-terminal background and
 * stays readable when used as colored body text. The strict-cobalt
 * `#0050FF` from the wordmark is preserved as `brandSat` for the rare
 * case where a saturated accent reads better than a luminance-balanced
 * one (e.g. small filled glyphs against white background).
 */
export const Theme = {
  brand: "#7fc8ff",
  brandSat: "#0050FF", // saturated cobalt — wordmark mark, filled accents
  brandDim: "#3a90c5",
  brandFg: "black", // text on brand-blue background (high contrast on #7fc8ff)
  text: "white",
  textDim: "gray",
  success: "green",
  warning: "yellow",
  error: "red",
  accent: "cyan",
} as const;

export type ThemeColor = (typeof Theme)[keyof typeof Theme];
