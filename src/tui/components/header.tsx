/**
 * Branded start-screen banner for the autousers TUI.
 *
 * Shows an ANSI Shadow wordmark of "AUTOUSERS" in brand blue, followed
 * by a metadata block (version, signed-in user/team/plan, working dir).
 * Modeled on the uxrater TUI's `mode-selector` ASCII logo — the wordmark
 * IS the brand identity in CLI context, no separate figure mark.
 *
 * Why no figure mark? Rendering the round Ä-on-blue logo to terminal
 * cells (half-blocks, sextants, even chafa) always looks pixelated
 * because the logo is anti-aliased vector art designed for high-DPI
 * displays — terminal cells are too coarse to convey curved detail.
 * Modern CLIs (`gh`, `vercel`, `stripe`, `npm`) skip figure marks for
 * the same reason; the wordmark in brand colour reads as confidently
 * branded without the fidelity loss.
 *
 * Layout:
 *
 *    █████╗ ██╗   ██╗████████╗ ██████╗ ██╗   ██╗███████╗███████╗██████╗ ███████╗
 *   ██╔══██╗██║   ██║╚══██╔══╝██╔═══██╗██║   ██║██╔════╝██╔════╝██╔══██╗██╔════╝
 *   ███████║██║   ██║   ██║   ██║   ██║██║   ██║███████╗█████╗  ██████╔╝███████╗
 *   ██╔══██║██║   ██║   ██║   ██║   ██║██║   ██║╚════██║██╔══╝  ██╔══██╗╚════██║
 *   ██║  ██║╚██████╔╝   ██║   ╚██████╔╝╚██████╔╝███████║███████╗██║  ██║███████║
 *   ╚═╝  ╚═╝ ╚═════╝    ╚═╝    ╚═════╝  ╚═════╝ ╚══════╝╚══════╝╚═╝  ╚═╝╚══════╝
 *
 *   CLI v{version}
 *   Signed in as {email} · {teamName} · /logout    [if authed; else "Not signed in · /login"]
 *   Plan: {plan} · {free}/{total} free runs left · /upgrade   [if authed]
 *   {cwd}
 *
 * The `/login`, `/logout`, and `/upgrade` strings are slash commands
 * dispatched through the command palette (open with `/`). They render
 * here as muted hints so the user knows the verb is typeable; the
 * dispatch lives in `command-palette.tsx`.
 *
 * Each visible line is rendered as a single `<Text>` element so React
 * reconciliation sees one child per line — nesting multiple `<Text>`
 * siblings with identical separator content (" · ") inside a parent
 * `<Text>` triggers Ink's duplicate-key warning at runtime.
 */
import { Box, Text } from "@jrichman/ink";

import { CLI_VERSION } from "../../client.js";
import { useTUIStore } from "../state.js";
import { Theme } from "../theme.js";

// ANSI Shadow font rendering of "AUTOUSERS" — 76 cols × 6 lines.
// Modeled on the same font uxrater used for its UXRATER wordmark.
const WORDMARK = String.raw` █████╗ ██╗   ██╗████████╗ ██████╗ ██╗   ██╗███████╗███████╗██████╗ ███████╗
██╔══██╗██║   ██║╚══██╔══╝██╔═══██╗██║   ██║██╔════╝██╔════╝██╔══██╗██╔════╝
███████║██║   ██║   ██║   ██║   ██║██║   ██║███████╗█████╗  ██████╔╝███████╗
██╔══██║██║   ██║   ██║   ██║   ██║██║   ██║╚════██║██╔══╝  ██╔══██╗╚════██║
██║  ██║╚██████╔╝   ██║   ╚██████╔╝╚██████╔╝███████║███████╗██║  ██║███████║
╚═╝  ╚═╝ ╚═════╝    ╚═╝    ╚═════╝  ╚═════╝ ╚══════╝╚══════╝╚═╝  ╚═╝╚══════╝`;

export function Header() {
  const authUser = useTUIStore((state) => state.authUser);
  const cwd = process.cwd();

  const teamSegment = authUser?.teamName ? ` · ${authUser.teamName}` : "";
  const signedInLine = authUser
    ? `Signed in as ${authUser.email}${teamSegment} · /logout`
    : "Not signed in · /login";

  const quotaSegment =
    authUser &&
    typeof authUser.freeRunsLeft === "number" &&
    typeof authUser.freeRunsTotal === "number"
      ? ` · ${authUser.freeRunsLeft}/${authUser.freeRunsTotal} free runs left`
      : "";
  const planLine =
    authUser && authUser.plan
      ? `Plan: ${authUser.plan}${quotaSegment} · /upgrade`
      : null;

  return (
    <Box flexDirection="column" paddingX={1} paddingY={0}>
      <Text color={Theme.brand} bold>
        {WORDMARK}
      </Text>
      <Box flexDirection="column" marginTop={1}>
        <Text bold>{`CLI v${CLI_VERSION}`}</Text>
        <Text>{signedInLine}</Text>
        {planLine ? <Text>{planLine}</Text> : null}
        <Text dimColor>{cwd}</Text>
      </Box>
    </Box>
  );
}
