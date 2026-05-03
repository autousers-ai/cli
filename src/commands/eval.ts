/**
 * Backwards-compat re-export. Wave 4 split the eval subcommand suite into
 * `commands/eval/{list,get,create,update,delete}.ts`, with the assembler
 * in `commands/eval/index.ts`. This file remains so existing imports of
 * `./commands/eval.js` (notably from `src/index.ts`) keep working without
 * a churn-y relocate.
 */
export { buildEvalCommand, evalCommand } from "./eval/index.js";
