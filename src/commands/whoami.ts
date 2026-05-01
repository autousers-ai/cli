/**
 * `autousers whoami` — print the active identity for the resolved API key.
 *
 * Two reads:
 *   1. `GET /api/v1/teams` — list of `{ id, name, role, isPersonal,
 *      memberCount, createdAt }` rows the caller belongs to. The active
 *      team is inferred as the personal team (the only one we can
 *      identify without a `/api/v1/me` route). Future: switch to a
 *      dedicated `/api/v1/me` once it lands so the answer is unambiguous.
 *   2. `GET /api/v1/usage?range=30d` — single call that doubles as a
 *      health check. We surface the free-quota counter so users running
 *      `whoami` after a session of agent runs immediately see "ah, only
 *      3 left" without a separate `usage` call.
 *
 * The two calls are issued in parallel — they're independent, both cheap,
 * and a sequential pair would round-trip ~150 ms on a coast-to-coast
 * connection.
 */

import type { Command } from "commander";

import { handleError } from "../lib/exit.js";
import { resolveContext } from "../lib/context.js";
import { bold, json as jsonStringify, kv, shortId } from "../output.js";

interface TeamRow {
  id: string;
  name: string;
  isPersonal: boolean;
  memberCount: number;
  userRole: string | null;
  createdAt: string;
}

interface TeamListEnvelope {
  data: TeamRow[];
  has_more: boolean;
}

interface UsageEnvelope {
  range: string;
  freeQuota: { used: number; limit: number | null };
  byok: boolean;
  byokConfigured: boolean;
}

export async function whoamiCommand(
  _opts: unknown,
  cmd: Command
): Promise<void> {
  try {
    const ctx = await resolveContext(cmd);

    // Parallel fetch — independent endpoints. Either one failing surfaces
    // through `handleError` with the right exit code.
    const [teamsRes, usageRes] = await Promise.all([
      ctx.client.get<TeamListEnvelope>("/api/v1/teams"),
      ctx.client.get<UsageEnvelope>("/api/v1/usage?range=30d"),
    ]);

    const teams = teamsRes.data;
    // Heuristic: the personal team is the user's "home". If for some
    // reason there's no personal team (unlikely — provisioning creates
    // one on first login), fall back to the first team in the list.
    const activeTeam = teams.find((t) => t.isPersonal) ?? teams[0] ?? null;

    if (ctx.jsonMode) {
      process.stdout.write(
        jsonStringify({
          baseUrl: ctx.baseUrl,
          teams,
          activeTeamId: activeTeam?.id ?? null,
          usage: usageRes,
        }) + "\n"
      );
      return;
    }

    process.stdout.write(`${bold("Signed in to")} ${ctx.baseUrl}\n`);
    const lines: Record<string, string> = {
      Teams: String(teams.length),
    };
    if (activeTeam) {
      const roleLabel = activeTeam.userRole ?? "Member";
      lines["Active team"] =
        `${activeTeam.name} (${shortId(activeTeam.id)})  [${roleLabel}]`;
    }

    const limit = usageRes.freeQuota.limit;
    const used = usageRes.freeQuota.used;
    if (limit === null) {
      lines["Free runs left"] = `unlimited beta (${used} used)`;
    } else {
      const remaining = Math.max(0, limit - used);
      lines["Free runs left"] = `${remaining}/${limit}`;
    }

    if (usageRes.byok) {
      lines["BYOK"] = "active";
    } else if (usageRes.byokConfigured) {
      lines["BYOK"] = "configured (inactive)";
    }

    process.stdout.write(kv(lines) + "\n");
  } catch (err) {
    handleError(err);
  }
}
