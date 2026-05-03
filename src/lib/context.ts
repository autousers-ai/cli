/**
 * Shared command context resolver.
 *
 * Each subcommand needs the same handful of inputs: a constructed
 * `AutousersClient`, the resolved `--json` / `--quiet` / `--no-color`
 * globals, and (for shaping help text in errors) the active base URL.
 * This helper centralizes that resolution so a new subcommand stays
 * three lines:
 *
 *   ```ts
 *   const ctx = await resolveContext(program);
 *   const data = await ctx.client.get<...>(...);
 *   ctx.print(...);
 *   ```
 *
 * Why not put this in `client.ts`?
 * --------------------------------
 * `client.ts` is owned by the parallel OAuth agent in this batch. We
 * deliberately keep our shared helper here, scoped to commands, so the
 * two efforts don't step on each other. If/when the OAuth agent surfaces
 * a `createClientFromConfig` factory, this helper can collapse into a
 * one-line wrapper around it.
 *
 * TODO: needs createClientFromConfig from client.ts — coordinate with
 * OAuth agent. For now we read `getApiKey` / `getBaseUrl` directly out
 * of `config.ts` so this file is self-sufficient.
 */

import type { Command } from "commander";

import { AutousersClient, createClientFromConfig } from "../client.js";
import { getBaseUrl } from "../config.js";
import { setColorEnabled } from "../output.js";

/** The shape commander hands us off the program-level flag wiring. */
export interface GlobalFlags {
  key?: string;
  baseUrl?: string;
  json?: boolean;
  quiet?: boolean;
  color?: boolean; // commander turns `--no-color` into `color: false`
}

/** Everything a subcommand needs, resolved exactly once per invocation. */
export interface CommandContext {
  client: AutousersClient;
  baseUrl: string;
  jsonMode: boolean;
  quietMode: boolean;
}

/**
 * Read the program-level options off the commander tree. We walk to the
 * root because subcommand actions receive the *subcommand* as `this` —
 * its own `.opts()` doesn't include the parent's `--key` / `--json`.
 */
export function readGlobalFlags(cmd: Command): GlobalFlags {
  let root: Command = cmd;
  while (root.parent) root = root.parent;
  return root.opts() as GlobalFlags;
}

/**
 * Resolve every input a subcommand needs and apply the side effect of
 * configuring the global color toggle. Centralizing the side effect here
 * means `--no-color` works regardless of which command rendered first.
 */
export async function resolveContext(cmd: Command): Promise<CommandContext> {
  const flags = readGlobalFlags(cmd);

  // Honor the conventional NO_COLOR env var as well as the explicit
  // --no-color flag. `flags.color` is `false` when `--no-color` was
  // passed; commander leaves it `undefined` otherwise.
  const colorOn =
    flags.color !== false &&
    !process.env.NO_COLOR &&
    Boolean(process.stdout.isTTY);
  setColorEnabled(colorOn);

  const baseUrl = await getBaseUrl(flags.baseUrl);
  const client = await createClientFromConfig({
    key: flags.key,
    baseUrl: flags.baseUrl,
  });

  return {
    client,
    baseUrl,
    jsonMode: Boolean(flags.json),
    quietMode: Boolean(flags.quiet),
  };
}
