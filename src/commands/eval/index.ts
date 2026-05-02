/**
 * `autousers eval` — barrel that assembles the eval subcommand tree.
 *
 * Each subcommand has its own file (list / get / create / update /
 * delete / run / status / watch / stop) so editing one doesn't churn
 * the others. The aggregator here stitches them together for the
 * top-level dispatcher in `src/index.ts`.
 *
 * Wave 1 shipped read-only `list` and `get`. Wave 4 added `create`,
 * `update`, `delete`. Wave 5 added `run`, `status`, `watch`, `stop`.
 * Future waves will add `results` / `ratings` / `export` (Wave 6),
 * `share` / `invite` / `transfer` (Wave 7).
 *
 * NOTE on registration shape: each subcommand exposes a
 * `register…Command(parent)` function rather than a freestanding
 * `Command` instance. Commander parses the `<positional>` suffix on
 * subcommand names ONLY when the command is created via the parent's
 * `.command("...")` factory — `new Command("get <id>")` produces a root-
 * level program with no positional parsing at all. Each register fn
 * therefore takes the parent it'll attach to and calls `.command(...)`
 * on it directly.
 */

import { Command } from "commander";

import { registerEvalCreateCommand } from "./create.js";
import { registerEvalDeleteCommand } from "./delete.js";
import { registerEvalExportCommand } from "./export.js";
import { registerEvalGetCommand } from "./get.js";
import { registerEvalInviteCommand } from "./invite.js";
import { registerEvalListCommand } from "./list.js";
import { registerEvalRatingsCommand } from "./ratings.js";
import { registerEvalResultsCommand } from "./results.js";
import { registerEvalRunCommand } from "./run.js";
import { registerEvalShareCommand } from "./share.js";
import { registerEvalStatusCommand } from "./status.js";
import { registerEvalStopCommand } from "./stop.js";
import { registerEvalTransferCommand } from "./transfer.js";
import { registerEvalUpdateCommand } from "./update.js";
import { registerEvalWatchCommand } from "./watch.js";

export function buildEvalCommand(): Command {
  const cmd = new Command("eval").description(
    "Manage evaluations (list, get, create, update, delete, run, status, watch, stop, results, ratings, export, share, invite, transfer)"
  );

  registerEvalListCommand(cmd);
  registerEvalGetCommand(cmd);
  registerEvalCreateCommand(cmd);
  registerEvalUpdateCommand(cmd);
  registerEvalDeleteCommand(cmd);
  registerEvalRunCommand(cmd);
  registerEvalStatusCommand(cmd);
  registerEvalWatchCommand(cmd);
  registerEvalStopCommand(cmd);
  registerEvalResultsCommand(cmd);
  registerEvalRatingsCommand(cmd);
  registerEvalExportCommand(cmd);
  registerEvalShareCommand(cmd);
  registerEvalInviteCommand(cmd);
  registerEvalTransferCommand(cmd);

  return cmd;
}

/** Backwards-compat export for the dispatcher. */
export const evalCommand = buildEvalCommand;
