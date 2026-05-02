/**
 * `autousers key` — barrel that assembles the API-key subcommand tree.
 */

import { Command } from "commander";

import { registerKeyCreateCommand } from "./create.js";
import { registerKeyListCommand } from "./list.js";
import { registerKeyRevokeCommand } from "./revoke.js";

export function buildKeyCommand(): Command {
  const cmd = new Command("key").description(
    "Manage external API keys: list, create, revoke"
  );

  registerKeyListCommand(cmd);
  registerKeyCreateCommand(cmd);
  registerKeyRevokeCommand(cmd);

  return cmd;
}

export const keyCommand = buildKeyCommand;
