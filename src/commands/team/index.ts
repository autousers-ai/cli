/**
 * `autousers team` — barrel that assembles the team subcommand tree.
 *
 * Wave 9 ships list / use / leave. Team creation lives on the web app
 * (it requires a billing-side flow); other team mutations (rename,
 * member role changes) belong on the web for the same reason.
 */

import { Command } from "commander";

import { registerTeamLeaveCommand } from "./leave.js";
import { registerTeamListCommand } from "./list.js";
import { registerTeamUseCommand } from "./use.js";

export function buildTeamCommand(): Command {
  const cmd = new Command("team").description(
    "Manage teams: list, use (set active), leave"
  );

  registerTeamListCommand(cmd);
  registerTeamUseCommand(cmd);
  registerTeamLeaveCommand(cmd);

  return cmd;
}

export const teamCommand = buildTeamCommand;
