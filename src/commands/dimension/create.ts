/**
 * `autousers dimension create` — create a dimension.
 * Wired to `POST /api/v1/dimensions`.
 */

import { Command } from "commander";

import { resolveContext } from "../../lib/context.js";
import { ExitCode, handleError } from "../../lib/exit.js";
import { bold, green, json as jsonStringify } from "../../output.js";

interface DimensionCreateOpts {
  name?: string;
  description?: string;
  scale?: string;
  team?: string;
}

function normalizeScale(value: string | undefined): {
  scaleType: "THREE_POINT" | "FIVE_POINT" | "SEVEN_POINT";
  scaleMin: number;
  scaleMax: number;
} {
  const v = (value ?? "FIVE_POINT").toUpperCase();
  if (v === "THREE_POINT" || v === "3" || v === "THREE") {
    return { scaleType: "THREE_POINT", scaleMin: 1, scaleMax: 3 };
  }
  if (v === "SEVEN_POINT" || v === "7" || v === "SEVEN") {
    return { scaleType: "SEVEN_POINT", scaleMin: 1, scaleMax: 7 };
  }
  return { scaleType: "FIVE_POINT", scaleMin: 1, scaleMax: 5 };
}

export async function dimensionCreateAction(
  opts: DimensionCreateOpts,
  cmd: Command
): Promise<void> {
  if (!opts.name) {
    process.stderr.write("error: --name is required\n");
    process.exit(ExitCode.VALIDATION);
    return;
  }

  try {
    const ctx = await resolveContext(cmd);
    const scale = normalizeScale(opts.scale);

    let teamId: string | undefined = opts.team;
    if (!teamId) {
      try {
        const me = await ctx.client.get<{ data: { teamId?: string } }>(
          "/api/v1/auth/whoami"
        );
        teamId = me.data.teamId;
      } catch {
        // server will reject if missing
      }
    }

    const env = await ctx.client.post<{
      data: { id: string; name: string };
    }>("/api/v1/dimensions", {
      teamId,
      name: opts.name,
      description: opts.description ?? "",
      type: "rating",
      icon: "📋",
      scaleType: scale.scaleType,
      scaleMin: scale.scaleMin,
      scaleMax: scale.scaleMax,
      isPrimary: false,
      openTextEnabled: false,
    });

    if (ctx.jsonMode) {
      process.stdout.write(jsonStringify(env) + "\n");
      return;
    }
    process.stdout.write(
      green("Created dimension") + ` ${bold(env.data.name)} (${env.data.id})\n`
    );
  } catch (err) {
    handleError(err);
  }
}

export function registerDimensionCreateCommand(parent: Command): Command {
  return parent
    .command("create")
    .description("Create a dimension")
    .option("--name <name>", "display name")
    .option("--description <desc>", "summary")
    .option("--scale <type>", "scale: THREE_POINT | FIVE_POINT | SEVEN_POINT")
    .option("--team <id>", "team id (defaults to active team)")
    .action(dimensionCreateAction);
}
