/**
 * `autousers dimension` — barrel that assembles the dimension
 * subcommand tree.
 *
 * Templates and dimensions are aliased server-side (`/api/v1/templates`
 * forwards to `/api/v1/dimensions`), but Wave 9 ships them as
 * separate command groups so scripted callers can pick the noun
 * matching their mental model.
 */

import { Command } from "commander";

import { registerDimensionCreateCommand } from "./create.js";
import { registerDimensionDeleteCommand } from "./delete.js";
import { registerDimensionDuplicateCommand } from "./duplicate.js";
import { registerDimensionListCommand } from "./list.js";
import { registerDimensionUpdateCommand } from "./update.js";
import { registerDimensionVersionCommand } from "./version.js";

export function buildDimensionCommand(): Command {
  const cmd = new Command("dimension").description(
    "Manage dimensions: list, create, update, delete, duplicate, version, version-revert"
  );

  registerDimensionListCommand(cmd);
  registerDimensionCreateCommand(cmd);
  registerDimensionUpdateCommand(cmd);
  registerDimensionDeleteCommand(cmd);
  registerDimensionDuplicateCommand(cmd);
  registerDimensionVersionCommand(cmd);

  return cmd;
}

export const dimensionCommand = buildDimensionCommand;
