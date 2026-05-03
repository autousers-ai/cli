/**
 * `autousers autouser` — barrel that assembles the autouser subcommand
 * tree.
 *
 * Wave 1 shipped only `list`. Wave 8 ports the rest:
 *   - `create` — flag-driven plus AI-assisted (`--describe`)
 *   - `update` — PATCH name / description / persona
 *   - `delete` — DELETE with --yes confirmation gate
 *   - `duplicate` — POST .../duplicate
 *   - `calibrate` — POST .../calibration/start
 *   - `freeze` — POST .../calibration/freeze
 *   - `optimize` — POST .../calibration/optimize
 *   - `rubrics` — list rubric versions
 *   - `rubric` — add / update individual rubrics
 *
 * Each subcommand has its own file so editing one doesn't churn the
 * others. The aggregator stitches them together for the top-level
 * dispatcher in `src/index.ts`.
 *
 * NOTE on registration shape: each subcommand exposes a
 * `register…Command(parent)` function rather than a freestanding
 * `Command` instance. Same rationale as `eval/index.ts` — commander
 * only parses `<positional>` suffixes via the parent's `.command()`
 * factory.
 */

import { Command } from "commander";

import { registerAutouserCalibrateCommand } from "./calibrate.js";
import { registerAutouserCreateCommand } from "./create.js";
import { registerAutouserDeleteCommand } from "./delete.js";
import { registerAutouserDuplicateCommand } from "./duplicate.js";
import { registerAutouserFreezeCommand } from "./freeze.js";
import { registerAutouserListCommand } from "./list.js";
import { registerAutouserOptimizeCommand } from "./optimize.js";
import { registerAutouserRubricCommand } from "./rubric.js";
import { registerAutouserRubricsCommand } from "./rubrics.js";
import { registerAutouserUpdateCommand } from "./update.js";

export function buildAutouserCommand(): Command {
  const cmd = new Command("autouser").description(
    "Manage autousers (calibrated AI personas): list, create, update, delete, duplicate, calibrate, freeze, optimize, rubrics, rubric"
  );

  registerAutouserListCommand(cmd);
  registerAutouserCreateCommand(cmd);
  registerAutouserUpdateCommand(cmd);
  registerAutouserDeleteCommand(cmd);
  registerAutouserDuplicateCommand(cmd);
  registerAutouserCalibrateCommand(cmd);
  registerAutouserFreezeCommand(cmd);
  registerAutouserOptimizeCommand(cmd);
  registerAutouserRubricsCommand(cmd);
  registerAutouserRubricCommand(cmd);

  return cmd;
}

/** Backwards-compat export used by `src/index.ts` and tests. */
export const autouserCommand = buildAutouserCommand;
