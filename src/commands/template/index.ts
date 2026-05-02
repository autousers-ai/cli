/**
 * `autousers template` — barrel that assembles the template subcommand
 * tree.
 *
 * Wave 1 shipped only `list`. Wave 9 ports the rest:
 *   - `create` — flag-driven plus AI-assisted (`--describe`)
 *   - `update` — PATCH name / description
 *   - `delete` — DELETE with --yes confirmation gate
 *   - `duplicate` — POST .../duplicate
 *
 * Mirrors the autouser/index.ts shape for consistency.
 */

import { Command } from "commander";

import { registerTemplateCreateCommand } from "./create.js";
import { registerTemplateDeleteCommand } from "./delete.js";
import { registerTemplateDuplicateCommand } from "./duplicate.js";
import { registerTemplateListCommand } from "./list.js";
import { registerTemplateUpdateCommand } from "./update.js";

export function buildTemplateCommand(): Command {
  const cmd = new Command("template").description(
    "Manage rating templates: list, create, update, delete, duplicate"
  );

  registerTemplateListCommand(cmd);
  registerTemplateCreateCommand(cmd);
  registerTemplateUpdateCommand(cmd);
  registerTemplateDeleteCommand(cmd);
  registerTemplateDuplicateCommand(cmd);

  return cmd;
}

export const templateCommand = buildTemplateCommand;
