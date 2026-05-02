/**
 * Backwards-compat re-export. Wave 1 lived as a single `template.ts`;
 * Wave 9 split it into `template/` (mirrors `eval/` and `autouser/`).
 * This file forwards to the new aggregator so any external import path
 * (`./commands/template.js`) keeps resolving.
 */

export { buildTemplateCommand, templateCommand } from "./template/index.js";
