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

/**
 * Ratings that were recorded and then kept out of every figure. Mirrors
 * `ExcludedRatingsBreakdown` in the web app's lib/rating-exclusion.ts —
 * duplicated rather than imported for the same reason `agreementColor` is: the
 * CLI ships as its own package and does not depend on the Next monorepo.
 *
 * Every field optional and defaulted, because a server older than the key
 * sends none of them and "we cannot say" must not print as "none".
 */
export interface ExcludedRatingsSummary {
  /** Every excluded row — automated failure or a rater's own skip. */
  total: number;
  /** The subset caused by the scraper, which is the count that implies an
   *  infrastructure fix rather than a judgement call. */
  automationFailures: number;
  /** Per-kind counts. Keys match `AUTOMATION_FAILURE_KINDS` server-side. */
  byKind: Record<string, number>;
  /** Excluded by a human rater during pre-qualification. */
  other: number;
}

/** Human-readable label + remedy per automation-failure kind. Kept in step
 *  with `AUTOMATION_FAILURE_LABELS` / `_REMEDIES` in the web app. An unknown
 *  kind from a newer server falls back to a generic line rather than being
 *  dropped — "we do not recognise this reason" must never mean "no reason". */
const EXCLUSION_COPY: Record<string, { label: string; remedy: string }> = {
  bot_blocked: {
    label: "blocked by bot protection",
    remedy: "re-run with --proxy (or enable the proxy default in Settings)",
  },
  no_session: {
    label: "browser session failed",
    remedy: "check the run's logs for a launch or navigation error",
  },
  stimulus_absent: {
    label: "the design under test was not there",
    // Deliberately does NOT say "re-run": this is the one kind a re-run cannot
    // fix. The page loads fine; the thing it was supposed to show is gone.
    remedy:
      "replace the stimulus URL — the page loaded but the content is gone",
  },
  webgl_unavailable: {
    label: "the page needed WebGL and the browser had none",
    // The opposite advice to `stimulus_absent` directly above, on a symptom
    // that looks the same from outside: here the URL is fine and one toggle
    // fixes it. The cost is named because turning software rendering on makes
    // the run easier to detect as automated — the reverse of what --proxy buys.
    remedy:
      "re-run with software WebGL on (evaluation → Advanced, or Settings → Browser & network); it renders WebGL sites but is easier to detect as automated",
  },
};

/**
 * One line per excluded reason: "2 blocked by bot protection — re-run with…".
 *
 * Exported for test, because this string IS the fix: the panel printed
 * `Ratings: 8` where ten were attempted, and a user had no way to learn that
 * the two missing ones were interstitials — which is the single fact that
 * would have told them to turn the proxy on.
 */
export function excludedRatingLines(
  excluded: ExcludedRatingsSummary
): string[] {
  const lines: string[] = [];
  let bucketed = 0;
  for (const [kind, count] of Object.entries(excluded.byKind)) {
    if (!count) continue;
    bucketed += count;
    const copy = EXCLUSION_COPY[kind];
    lines.push(
      copy
        ? `${count} ${copy.label} — ${copy.remedy}`
        : `${count} excluded (${kind}) — update the CLI to read this reason`
    );
  }
  // A forward-compatible kind this build has no bucket for still gets a line.
  const unbucketed = excluded.automationFailures - bucketed;
  if (unbucketed > 0) {
    lines.push(
      `${unbucketed} automated session${unbucketed === 1 ? "" : "s"} failed — update the CLI to read the reason`
    );
  }
  if (excluded.other > 0) {
    lines.push(`${excluded.other} skipped by a rater`);
  }
  return lines;
}

/** The "nothing was excluded" summary — a named zero, so a caller never has to
 *  guard an undefined. */
export function noExcludedRatings(): ExcludedRatingsSummary {
  return { total: 0, automationFailures: 0, byKind: {}, other: 0 };
}

export interface OverallStats {
  isSSE: boolean;
  /**
   * The USABLE rating count — what every figure on this screen was computed
   * from. Read it beside {@link OverallStats.excluded}: on an evaluation with
   * blocked scrapes the two do not add up to what the user thinks they ran,
   * and the panel has to say so.
   */
  totalRatings: number;
  /** Recorded and then held out of every figure above. */
  excluded: ExcludedRatingsSummary;
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
  /**
   * Direct-count inter-rater agreement (0-100): the share of scored items on
   * which two raters gave the same score, or for SxS picked the same side.
   * NOT a kappa rescaled onto a percentage — read it against the chance floor
   * of the scale, which is what `agreementColor` in the tabs does.
   */
  percentAgreement: number;
  /**
   * The server's overall UNWEIGHTED kappa. Null when kappa is undefined —
   * notably when every rater gave identical scores, where the arithmetic is
   * 0/0. Null, not 0: a panel that agreed unanimously and a panel that agreed
   * only as often as chance are opposite results and must not print the same.
   */
  kappa: number | null;
  /**
   * True when `kappa` is an item-count-weighted MEAN of several Cohen's
   * kappas rather than one. The normal case here, and the reason the panel
   * must not label the number "Cohen's Kappa" unconditionally.
   */
  kappaIsMean: boolean;
  /**
   * Raters that ran but were left out of every figure above, because the run
   * behind them was cancelled, failed, or is still in flight.
   *
   * Shown next to the numbers, not hidden: the exclusion moves them, sometimes
   * a long way (a live evaluation's mean pairwise kappa went from 0.31 to 0.93
   * when a cancelled run stopped counting as a rater). Their SCORES are real
   * and still count toward each design's averages — only the rater is
   * withdrawn, because a run that covered part of the evaluation — or judged
   * all of it from a session an error cut short — is not a peer
   * of one that covered all of it.
   */
  withdrawnRaters: number;
  /**
   * Raters that ARE counted above but covered less than the whole evaluation —
   * the other half of `withdrawnRaters`.
   *
   * A large evaluation is split across pods into runs over disjoint designs,
   * and those runs are ONE rater; when one of them fails, the rater keeps its
   * identity and stands over what the rest covered rather than being
   * withdrawn. That is the server's rule and it is a defensible one — the
   * kappa blend is shared-item weighted, so short coverage costs precision,
   * not validity — but only while the panel says so. Without this line the
   * rater count claims two equal peers where one covered two thirds as much.
   */
  partialRaters: number;
  /**
   * The thinnest of them, in designs: `[covered, in the evaluation]`. Null
   * when nothing is partial, or when the server is too old to send coverage.
   * The count alone does not say whether the shortfall is one design or
   * twenty, and those read very differently.
   */
  partialLowestCoverage: [number, number] | null;
  /** Number of rater-pair × item observations behind the percentage. */
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
  /** Absent on an envelope from a server older than the exclusion rollout —
   *  hence optional, and normalised through `readExcluded` below. */
  excludedRatings?: Partial<ExcludedRatingsSummary> | null;
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
  /** See `ServerSxSAggregateStats.excludedRatings`. */
  excludedRatings?: Partial<ExcludedRatingsSummary> | null;
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
    percentAgreement?: number | null;
    kappa?: number | null;
    kappaIsMean?: boolean;
    pairs?: number;
    /**
     * The server's `KappaInterpretation` ENUM — "near_perfect", not "Almost
     * perfect". Rendering it straight is what put a snake_case identifier in
     * the panel; `kappaLabelFor` translates it.
     */
    label?: string | null;
    /** Raters withdrawn because their run never finished. Absent on an
     *  envelope from a server older than agreement cache version 10. */
    excludedRaters?: unknown[] | null;
    /** Raters counted over less than the whole evaluation. Absent on an
     *  envelope from a server older than agreement cache version 12. */
    partialRaters?: unknown[] | null;
  } | null;
}

/** One `partialRaters` entry, reduced to the coverage this panel reports.
 *
 *  Read defensively rather than cast: the array is typed `unknown[]` above
 *  because the CLI ships separately from the server and may meet an envelope
 *  whose entries it has never seen. A missing count must read as "no coverage
 *  figure", never as zero designs covered — that would print a shortfall
 *  larger than the one that exists. */
function readCoverage(entry: unknown): [number, number] | null {
  if (!entry || typeof entry !== "object") return null;
  const e = entry as Record<string, unknown>;
  const rated = e.ratedComparisons;
  const total = e.evaluationComparisons;
  if (typeof rated !== "number" || typeof total !== "number") return null;
  if (!Number.isFinite(rated) || !Number.isFinite(total) || total <= 0) {
    return null;
  }
  return [rated, total];
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

/**
 * Normalise the envelope's exclusion breakdown.
 *
 * Every field defaulted, because an older server sends the key not at all and
 * a partial one could send `byKind` without `other`. A missing count reads as
 * zero here — which is safe only because the SERVER is the authority on
 * whether anything was excluded, and an old server also never excluded
 * anything from `totalRatings`.
 */
function readExcluded(
  raw: Partial<ExcludedRatingsSummary> | null | undefined
): ExcludedRatingsSummary {
  if (!raw) return noExcludedRatings();
  return {
    total: raw.total ?? 0,
    automationFailures: raw.automationFailures ?? 0,
    byKind: raw.byKind ?? {},
    other: raw.other ?? 0,
  };
}

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

/**
 * Prose for each band the server's `KappaInterpretation` enum names.
 *
 * The server sends the enum, not the prose. Passing it through unchanged put
 * "near_perfect" and "substantial" in front of a person, which is what turning
 * the agreement panel back on exposed.
 */
const KAPPA_LABEL_BY_BAND: Record<string, string> = {
  poor: "Worse than chance",
  // 0.00-0.20. Its own band since cache version 10: it used to be folded into
  // "fair", so a kappa of exactly zero — agreement no better than guessing —
  // was printed here as "Fair".
  slight: "Slight (near chance)",
  fair: "Fair",
  moderate: "Moderate",
  substantial: "Substantial",
  near_perfect: "Almost perfect",
};

/**
 * Local fallback for an envelope that carries no label.
 *
 * The boundaries are Landis & Koch as `interpretKappa` in the web app's
 * lib/kappa.ts applies them (0.21 / 0.41 / 0.61 / 0.81), NOT the 0.2/0.4/0.6/
 * 0.8 this used to use with a different set of words. Two vocabularies for one
 * number meant the same kappa read "Fair" or "Moderate" depending only on
 * whether the server had filled in the label.
 *
 * The NAMES on those boundaries shifted down one in cache version 10 — the
 * table had six labels over Landis & Koch's six bands with `slight` missing,
 * so every band read one step too generously. Keep this in step with
 * `interpretKappa`; a server that has not yet deployed version 10 will still
 * send `strong`, which falls back to the raw token rather than being silently
 * re-mapped to a band it does not mean.
 */
function kappaLabel(k: number): string {
  if (k < 0) return KAPPA_LABEL_BY_BAND.poor;
  if (k < 0.21) return KAPPA_LABEL_BY_BAND.slight;
  if (k < 0.41) return KAPPA_LABEL_BY_BAND.fair;
  if (k < 0.61) return KAPPA_LABEL_BY_BAND.moderate;
  if (k < 0.81) return KAPPA_LABEL_BY_BAND.substantial;
  return KAPPA_LABEL_BY_BAND.near_perfect;
}

/** Server enum first, local bands second, "undefined" when there is no kappa. */
function kappaLabelFor(
  serverLabel: string | null | undefined,
  kappa: number | null
): string {
  if (serverLabel && serverLabel in KAPPA_LABEL_BY_BAND) {
    return KAPPA_LABEL_BY_BAND[serverLabel];
  }
  if (kappa === null) return "undefined";
  return kappaLabel(kappa);
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
      excluded: readExcluded(a.excludedRatings),
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
      excluded: readExcluded(a.excludedRatings),
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
    const kappa = envelope.agreement.kappa ?? null;
    const partial = Array.isArray(envelope.agreement.partialRaters)
      ? envelope.agreement.partialRaters
      : [];
    // The thinnest coverage, because the count alone cannot distinguish a
    // rater one design short from one that covered a third of the evaluation.
    const coverages = partial
      .map(readCoverage)
      .filter((c): c is [number, number] => c !== null);
    agreement = {
      percentAgreement: envelope.agreement.percentAgreement,
      kappa,
      kappaIsMean: envelope.agreement.kappaIsMean ?? false,
      pairCount: envelope.agreement.pairs ?? 0,
      kappaLabel: kappaLabelFor(envelope.agreement.label, kappa),
      withdrawnRaters: Array.isArray(envelope.agreement.excludedRaters)
        ? envelope.agreement.excludedRaters.length
        : 0,
      partialRaters: partial.length,
      partialLowestCoverage:
        coverages.length === 0
          ? null
          : coverages.reduce((lowest, c) =>
              c[0] / c[1] < lowest[0] / lowest[1] ? c : lowest
            ),
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
        overall: {
          isSSE: false,
          totalRatings: 0,
          excluded: noExcludedRatings(),
          totalComparisons: 0,
        },
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
        overall: {
          isSSE: false,
          totalRatings: 0,
          excluded: noExcludedRatings(),
          totalComparisons: 0,
        },
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
