/**
 * `useResultsData` — fetch + cache + adapt the server's
 * `/api/v1/evaluations/:id/results` response into a shape the ported
 * uxrater results components can consume.
 *
 * Why an adapter and not a 1:1 port?
 * ----------------------------------
 * uxrater's hook ran client-side over the local TUI sessions Map, which
 * meant it had to do all the math (means, CIs, kappa, agreement) in the
 * browser. autousers' server already computes the rich
 * `SxS|SSEEvaluationResults` shape — comparison stats with
 * dimension/factor breakdowns, aggregate stats with overall
 * winner/confidence, etc. The adapter normalises that into the
 * `ResultsData` view-model that {@link TabOverall}, {@link TabComparisons},
 * and {@link TabStats} render. The view-model intentionally mirrors
 * uxrater's shape so the ported component code only needed minimal
 * tweaks (no longer iterates SessionState; reads from precomputed
 * structures).
 *
 * Concurrency / cache
 * -------------------
 * Module-level `cache: Map<evalId, ResultsData>`. A second call for the
 * same eval-id within the same process re-uses the prior result; the
 * results screen's `e` (export) and `o` (open in browser) keybinds
 * never trigger a refetch. To force a refresh, call
 * {@link invalidateResultsCache} (used by tests).
 */

import { useEffect, useState } from "react";

import {
  createClientFromConfig,
  type AutousersClient,
} from "../../../client.js";

// ============================================
// Adapted types (mirrors uxrater's, server-shaped)
// ============================================

export type WinnerSide = "sideA" | "sideB" | "tie";
export type ConfidenceLevel = "High" | "Medium" | "Low" | "Insufficient";

export interface ConfidenceInterval {
  lower: number;
  upper: number;
}

export interface ComparisonSummary {
  comparisonId: string;
  label: string;
  position: number;
  runCount: number;
  /** Computed average across dimensions; SSE uses this directly,
   *  SxS uses it as `meanRating` for display. */
  overallAvg: number;
  isSSE: boolean;
  /** Per-dimension averages (SSE) or means (SxS). */
  dimensionAverages: Map<string, number>;
  // SxS specifics
  winner?: WinnerSide | "inconclusive";
  confidence?: ConfidenceLevel;
  sideAWins?: number;
  sideBWins?: number;
  ties?: number;
}

export interface DimensionSummary {
  id: string;
  name: string;
  mean: number;
  stdDev: number;
  ci: ConfidenceInterval;
  // SxS
  sideAWins?: number;
  sideBWins?: number;
  ties?: number;
  winner?: WinnerSide | "inconclusive";
  // SSE
  qualityLabel?: string;
  distribution?: Record<number, number>;
}

export interface OverallStats {
  isSSE: boolean;
  totalRatings: number;
  totalComparisons: number;
  // SSE
  overallAvg?: number;
  confidence?: ConfidenceLevel;
  // SxS
  sideAWins?: number;
  sideBWins?: number;
  ties?: number;
  sideAWinPct?: number;
  sideBWinPct?: number;
  tiePct?: number;
  overallWinner?: WinnerSide | "inconclusive";
  winRate?: number;
}

export interface RatingDistribution {
  value: number;
  count: number;
  pct: number;
}

export interface AgreementSummary {
  /** Inter-rater agreement percentage (0-100). */
  percentAgreement: number;
  /** Weighted Kappa value. */
  kappa: number;
  /** Number of pairs used to compute the percentage. */
  pairCount: number;
  /** Human-readable label for the kappa value. */
  kappaLabel: string;
}

export interface ResultsData {
  loading: boolean;
  error: string | null;
  evaluationName: string;
  evaluationStatus: string;
  isSSE: boolean;
  summaries: ComparisonSummary[];
  allDimIds: string[];
  dimensionSummaries: Map<string, DimensionSummary>;
  overall: OverallStats;
  distribution: RatingDistribution[];
  agreement?: AgreementSummary;
  /** Side labels for SxS evals. Empty strings for SSE. */
  sideALabel: string;
  sideBLabel: string;
  /** The `links.web` field returned by the server, if any. */
  webLink?: string;
  /** Raw response for the `--json` plain-mode pass-through. */
  raw: ServerResultsEnvelope | null;
}

// ============================================
// Server response (matches @/types/results loosely; we re-declare
// here so the CLI doesn't depend on the Next monorepo types module)
// ============================================

interface ServerEvaluation {
  id: string;
  name: string;
  type: "SxS" | "SSE";
  status: string;
  links?: { web?: string };
}

interface ServerSxSDimensionStats {
  dimensionId: string;
  dimensionName: string;
  sideAWins: number;
  sideBWins: number;
  ties: number;
  total: number;
  meanRating: number;
  confidenceInterval: { lower: number; upper: number };
  winner: "sideA" | "sideB" | "tie" | "inconclusive";
}

interface ServerSSEDimensionStats {
  dimensionId: string;
  dimensionName: string;
  distribution: Record<string, number>;
  total: number;
  meanRating: number;
  stdDev: number;
  confidenceInterval: { lower: number; upper: number };
}

interface ServerSxSComparisonStats {
  comparisonId: string;
  label: string;
  position: number;
  validRatingsCount: number;
  dimensionStats: Record<string, ServerSxSDimensionStats>;
  overallWinner: "sideA" | "sideB" | "tie" | "tied";
  confidence: { level: ConfidenceLevel; margin: number };
}

interface ServerSSEComparisonStats {
  comparisonId: string;
  label: string;
  position: number;
  validRatingsCount: number;
  dimensionStats: Record<string, ServerSSEDimensionStats>;
  overallAverage: number;
  confidence: { level: ConfidenceLevel; margin: number };
}

interface ServerSxSAggregateStats {
  totalRatings: number;
  totalComparisons: number;
  overallWinner: "sideA" | "sideB" | "tie" | "tied";
  dimensionStats: Record<string, ServerSxSDimensionStats>;
  winRate: number;
  confidence: { level: ConfidenceLevel; margin: number };
  sideAWins: number;
  sideBWins: number;
  ties: number;
}

interface ServerSSEAggregateStats {
  totalRatings: number;
  totalComparisons: number;
  overallAverage: number;
  dimensionStats: Record<string, ServerSSEDimensionStats>;
  confidence: { level: ConfidenceLevel; margin: number };
  overallDistribution: Record<string, number>;
}

export interface ServerResultsEnvelope {
  evaluation: ServerEvaluation;
  dimensions?: Array<{ id: string; name: string }>;
  primaryDimensionId?: string;
  aggregateStats: ServerSxSAggregateStats | ServerSSEAggregateStats;
  comparisonStats: Array<ServerSxSComparisonStats | ServerSSEComparisonStats>;
  sideALabel?: string;
  sideBLabel?: string;
  perRater?: unknown[];
  agreement?: {
    percentAgreement?: number;
    kappa?: number;
    pairs?: number;
    label?: string;
  } | null;
}

// ============================================
// Cache
// ============================================

const cache = new Map<string, ResultsData>();

export function invalidateResultsCache(evaluationId?: string): void {
  if (evaluationId) {
    cache.delete(evaluationId);
  } else {
    cache.clear();
  }
}

// ============================================
// Adapter
// ============================================

/** Type guard for SSE aggregate stats. */
function isSSEAggregate(
  stats: ServerSxSAggregateStats | ServerSSEAggregateStats
): stats is ServerSSEAggregateStats {
  return "overallAverage" in stats;
}

/** Type guard for SSE comparison stats. */
function isSSEComparison(
  stats: ServerSxSComparisonStats | ServerSSEComparisonStats
): stats is ServerSSEComparisonStats {
  return "overallAverage" in stats;
}

function qualityLabel(score: number, max: number): string {
  const ratio = score / max;
  if (ratio >= 0.9) return "Excellent";
  if (ratio >= 0.7) return "Very Good";
  if (ratio >= 0.5) return "Good";
  if (ratio >= 0.3) return "Fair";
  return "Poor";
}

function kappaLabel(k: number): string {
  if (k < 0) return "Worse than chance";
  if (k < 0.2) return "Slight";
  if (k < 0.4) return "Fair";
  if (k < 0.6) return "Moderate";
  if (k < 0.8) return "Substantial";
  return "Almost perfect";
}

export function adaptServerResults(
  envelope: ServerResultsEnvelope
): ResultsData {
  const isSSE = envelope.evaluation.type === "SSE";
  const dimMeta = new Map<string, string>();
  for (const d of envelope.dimensions ?? []) {
    dimMeta.set(d.id, d.name);
  }

  // Per-comparison summaries
  const summaries: ComparisonSummary[] = [];
  for (const cs of envelope.comparisonStats) {
    const dimensionAverages = new Map<string, number>();
    for (const [dimId, ds] of Object.entries(cs.dimensionStats)) {
      dimensionAverages.set(dimId, ds.meanRating);
    }

    let overallAvg = 0;
    if (isSSEComparison(cs)) {
      overallAvg = cs.overallAverage;
    } else {
      // SxS: average across dimension means
      const vals = [...dimensionAverages.values()];
      overallAvg =
        vals.length > 0 ? vals.reduce((a, b) => a + b, 0) / vals.length : 0;
    }

    const summary: ComparisonSummary = {
      comparisonId: cs.comparisonId,
      label: cs.label,
      position: cs.position,
      runCount: cs.validRatingsCount,
      overallAvg,
      isSSE: isSSEComparison(cs),
      dimensionAverages,
      confidence: cs.confidence?.level,
    };

    if (!isSSEComparison(cs)) {
      let sideAWins = 0;
      let sideBWins = 0;
      let ties = 0;
      for (const ds of Object.values(cs.dimensionStats)) {
        sideAWins += ds.sideAWins;
        sideBWins += ds.sideBWins;
        ties += ds.ties;
      }
      summary.sideAWins = sideAWins;
      summary.sideBWins = sideBWins;
      summary.ties = ties;
      summary.winner =
        cs.overallWinner === "tied"
          ? "tie"
          : (cs.overallWinner ?? "inconclusive");
    }
    summaries.push(summary);
  }

  // Aggregate dimension stats
  const dimensionSummaries = new Map<string, DimensionSummary>();
  const allDimIds: string[] = [];
  for (const [dimId, ds] of Object.entries(
    envelope.aggregateStats.dimensionStats
  )) {
    allDimIds.push(dimId);
    if (isSSEAggregate(envelope.aggregateStats)) {
      const sseDs = ds as ServerSSEDimensionStats;
      const distribution: Record<number, number> = {};
      for (const [k, v] of Object.entries(sseDs.distribution)) {
        distribution[Number(k)] = v;
      }
      dimensionSummaries.set(dimId, {
        id: dimId,
        name: dimMeta.get(dimId) ?? sseDs.dimensionName,
        mean: sseDs.meanRating,
        stdDev: sseDs.stdDev,
        ci: sseDs.confidenceInterval,
        qualityLabel: qualityLabel(sseDs.meanRating, 5),
        distribution,
      });
    } else {
      const sxsDs = ds as ServerSxSDimensionStats;
      dimensionSummaries.set(dimId, {
        id: dimId,
        name: dimMeta.get(dimId) ?? sxsDs.dimensionName,
        mean: sxsDs.meanRating,
        stdDev: 0,
        ci: sxsDs.confidenceInterval,
        sideAWins: sxsDs.sideAWins,
        sideBWins: sxsDs.sideBWins,
        ties: sxsDs.ties,
        winner: sxsDs.winner === "tie" ? "tie" : sxsDs.winner,
      });
    }
  }

  // Overall stats
  let overall: OverallStats;
  if (isSSEAggregate(envelope.aggregateStats)) {
    const a = envelope.aggregateStats;
    overall = {
      isSSE: true,
      totalRatings: a.totalRatings,
      totalComparisons: a.totalComparisons,
      overallAvg: a.overallAverage,
      confidence: a.confidence?.level,
    };
  } else {
    const a = envelope.aggregateStats;
    const total = a.sideAWins + a.sideBWins + a.ties;
    const winner: WinnerSide | "inconclusive" =
      a.overallWinner === "tied" ? "tie" : (a.overallWinner ?? "inconclusive");
    overall = {
      isSSE: false,
      totalRatings: a.totalRatings,
      totalComparisons: a.totalComparisons,
      sideAWins: a.sideAWins,
      sideBWins: a.sideBWins,
      ties: a.ties,
      sideAWinPct: total > 0 ? (a.sideAWins / total) * 100 : 0,
      sideBWinPct: total > 0 ? (a.sideBWins / total) * 100 : 0,
      tiePct: total > 0 ? (a.ties / total) * 100 : 0,
      overallWinner: winner,
      winRate: a.winRate,
      confidence: a.confidence?.level,
    };
  }

  // Distribution
  const distribution: RatingDistribution[] = [];
  if (isSSEAggregate(envelope.aggregateStats)) {
    const dist = envelope.aggregateStats.overallDistribution ?? {};
    const keys = [1, 2, 3, 4, 5];
    const total = keys.reduce((s, k) => s + (dist[String(k)] ?? 0), 0);
    for (const k of keys) {
      const count = dist[String(k)] ?? 0;
      distribution.push({
        value: k,
        count,
        pct: total > 0 ? (count / total) * 100 : 0,
      });
    }
  } else {
    // SxS distribution: derive from aggregate dimensionStats sideA/B/ties.
    // Server doesn't expose a pre-binned -3..+3 distribution, so we fall
    // back to a simple {-1, 0, +1} bucket from aggregate counts. The
    // dimension table on the Stats tab carries the precise per-dimension
    // numbers for users who need more detail.
    const a = envelope.aggregateStats;
    const counts: Record<number, number> = {
      [-1]: a.sideAWins,
      [0]: a.ties,
      [1]: a.sideBWins,
    };
    const total = a.sideAWins + a.sideBWins + a.ties;
    for (const k of [-3, -2, -1, 0, 1, 2, 3]) {
      const count = counts[k] ?? 0;
      distribution.push({
        value: k,
        count,
        pct: total > 0 ? (count / total) * 100 : 0,
      });
    }
  }

  // Agreement
  let agreement: AgreementSummary | undefined;
  if (
    envelope.agreement &&
    typeof envelope.agreement.percentAgreement === "number"
  ) {
    agreement = {
      percentAgreement: envelope.agreement.percentAgreement,
      kappa: envelope.agreement.kappa ?? 0,
      pairCount: envelope.agreement.pairs ?? 0,
      kappaLabel:
        envelope.agreement.label ?? kappaLabel(envelope.agreement.kappa ?? 0),
    };
  }

  return {
    loading: false,
    error: null,
    evaluationName: envelope.evaluation.name,
    evaluationStatus: envelope.evaluation.status,
    isSSE,
    summaries,
    allDimIds,
    dimensionSummaries,
    overall,
    distribution,
    agreement,
    sideALabel: envelope.sideALabel ?? "",
    sideBLabel: envelope.sideBLabel ?? "",
    webLink: envelope.evaluation.links?.web,
    raw: envelope,
  };
}

// ============================================
// Hook
// ============================================

export interface UseResultsDataOptions {
  /** Override the API client factory (tests). */
  createClient?: () => Promise<Pick<AutousersClient, "get">>;
}

const PENDING_KEY = Symbol("pending");

export function useResultsData(
  evaluationId: string | null,
  options: UseResultsDataOptions = {}
): ResultsData {
  const initial: ResultsData = evaluationId
    ? (cache.get(evaluationId) ?? {
        loading: true,
        error: null,
        evaluationName: "",
        evaluationStatus: "",
        isSSE: false,
        summaries: [],
        allDimIds: [],
        dimensionSummaries: new Map(),
        overall: { isSSE: false, totalRatings: 0, totalComparisons: 0 },
        distribution: [],
        sideALabel: "",
        sideBLabel: "",
        raw: null,
      })
    : {
        loading: false,
        error: "No evaluation id",
        evaluationName: "",
        evaluationStatus: "",
        isSSE: false,
        summaries: [],
        allDimIds: [],
        dimensionSummaries: new Map(),
        overall: { isSSE: false, totalRatings: 0, totalComparisons: 0 },
        distribution: [],
        sideALabel: "",
        sideBLabel: "",
        raw: null,
      };

  const [data, setData] = useState<ResultsData>(initial);

  useEffect(() => {
    if (!evaluationId) return;
    const cached = cache.get(evaluationId);
    if (cached) {
      setData(cached);
      return;
    }
    let cancelled = false;
    void (async () => {
      try {
        const client = options.createClient
          ? await options.createClient()
          : await createClientFromConfig({});
        const env = await client.get<ServerResultsEnvelope>(
          `/api/v1/evaluations/${encodeURIComponent(evaluationId)}/results`
        );
        const adapted = adaptServerResults(env);
        cache.set(evaluationId, adapted);
        if (!cancelled) setData(adapted);
      } catch (err) {
        if (cancelled) return;
        const msg = err instanceof Error ? err.message : String(err);
        setData((d) => ({ ...d, loading: false, error: msg }));
      }
    })();
    return () => {
      cancelled = true;
    };
    // We intentionally exclude options.createClient from deps — tests
    // pass a stable factory and prod uses the default once per mount.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [evaluationId]);

  return data;
}

// Sentinel exported for tests that want to introspect cache state
// without invalidating it.
export const __INTERNAL_CACHE_SENTINEL = PENDING_KEY;
