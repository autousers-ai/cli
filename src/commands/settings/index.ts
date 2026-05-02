/**
 * `autousers settings` — root for the Wave-9 settings subcommand tree.
 *
 * Currently hosts the `byok` group; future waves can add `defaults`
 * (output format, color), `notifications`, etc. here without churning
 * the top-level dispatcher.
 */

import { Command } from "commander";

import { registerByokProbeCommand } from "./byok/probe.js";
import { registerByokSetCommand } from "./byok/set.js";
import { registerByokTestCommand } from "./byok/test.js";
import { registerByokUnsetCommand } from "./byok/unset.js";

export function buildSettingsCommand(): Command {
  const cmd = new Command("settings").description("Manage user settings");

  const byok = cmd
    .command("byok")
    .description(
      "Bring-Your-Own-Key for Gemini: set / test / probe / unset (Gemini-only by design)"
    );

  registerByokSetCommand(byok);
  registerByokTestCommand(byok);
  registerByokProbeCommand(byok);
  registerByokUnsetCommand(byok);

  return cmd;
}

export const settingsCommand = buildSettingsCommand;
