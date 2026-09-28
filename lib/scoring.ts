import type { MemoryExperience, RankedCandidate } from "@/lib/types";

/**
 * Application-side ranking of recalled past incidents.
 *
 * The LLM never ranks anything — Groq receives the output of this module,
 * already sorted, and only phrases the final suggestion.
 *
 *   score = 0.55 * semantic   (similarity returned by Hindsight recall)
 *         + 0.30 * success    (outcome-aware: own outcome + approach aggregate)
 *         + 0.15 * recency    (mild decay — old incidents are NOT excluded)
 *
 * The success component is NOT shared across the whole error signature. Each
 * candidate gets its own value: its recorded outcome blended with the aggregate
 * over records that used the SAME resolution approach, so a fix whose own
 * outcome was a failure always scores clearly below successful ones.
 */
export const SCORE_WEIGHTS = {
  semantic: 0.55,
  successRate: 0.3,
  recency: 0.15,
} as const;

/** How much the candidate's OWN outcome counts vs its approach group's aggregate. */
export const SUCCESS_BLEND = {
  own: 0.35,
  approach: 0.65,
} as const;

/** Recency half-life in days: 45-day-old memory still carries ~50% of its boost. */
export const RECENCY_HALF_LIFE_DAYS = 45;

/** Laplace-smoothed success rate — avoids 0/0 and never fully trusts 1/1 samples. */
export function successRate(successes: number, attempts: number): number {
  if (attempts <= 0) return 0.5;
  return (successes + 1) / (attempts + 2);
}

/**
 * Outcome-aware success for ONE candidate:
 *   own recorded outcome (1/0)  blended with  the Laplace aggregate over every
 *   record sharing this candidate's resolution approach.
 *
 * A failure (own=0) is capped at 0.65·aggregate — always far below the same
 * aggregate for a successful record (≥0.35 + 0.65·aggregate) — so failed fixes
 * can never outrank successful ones on the success component.
 * Unknown outcomes (own=undefined) fall back to the aggregate alone.
 */
export function candidateSuccessRate(
  own: boolean | undefined,
  successes: number,
  attempts: number,
): number {
  const aggregate = successRate(successes, attempts);
  if (own === undefined) return aggregate;
  return SUCCESS_BLEND.own * (own ? 1 : 0) + SUCCESS_BLEND.approach * aggregate;
}

/** Exponential recency boost in (0, 1]; older records decay but never hit zero. */
export function recencyScore(ageDays: number): number {
  const age = Math.max(0, ageDays);
  return Math.pow(0.5, age / RECENCY_HALF_LIFE_DAYS);
}

export function ageInDays(iso: string | undefined, now = Date.now()): number {
  if (!iso) return 90;
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return 90;
  return Math.max(0, (now - t) / (24 * 60 * 60 * 1000));
}

/**
 * Normalize raw similarity values into 0..1.
 * Hindsight `scores.semantic` is already 0..1 cosine; the local fallback
 * returns overlap ratios also in 0..1, so this is mostly defensive.
 */
export function normalizeSimilarity(raw: number): number {
  if (!Number.isFinite(raw)) return 0;
  return Math.min(1, Math.max(0, raw));
}

export interface RankInput {
  experience: MemoryExperience;
  /** Raw semantic similarity (0..1). */
  semantic: number;
  /** Successes across the candidate's resolution-approach group. */
  successes: number;
  /** Total records in the candidate's resolution-approach group. */
  attempts: number;
}

/**
 * Rank recalled experiences. Returns candidates sorted by score (desc),
 * each carrying the component breakdown shown in the UI.
 */
export function rankCandidates(inputs: RankInput[]): RankedCandidate[] {
  const now = Date.now();
  const ranked = inputs.map<RankedCandidate>((input) => {
    const semantic = normalizeSimilarity(input.semantic);
    const rate = candidateSuccessRate(
      input.experience.success,
      input.successes,
      input.attempts,
    );
    const ageDays = ageInDays(input.experience.occurredAt, now);
    const recency = recencyScore(ageDays);
    const score =
      SCORE_WEIGHTS.semantic * semantic +
      SCORE_WEIGHTS.successRate * rate +
      SCORE_WEIGHTS.recency * recency;
    return {
      experience: input.experience,
      semanticScore: semantic,
      successRate: rate,
      successes: input.successes,
      attempts: input.attempts,
      recencyScore: recency,
      ageDays,
      score,
      rank: 0,
    };
  });

  ranked.sort((a, b) => b.score - a.score || b.semanticScore - a.semanticScore);
  ranked.forEach((c, i) => {
    c.rank = i + 1;
  });
  return ranked;
}

/** Confidence heuristic used by the local LLM fallback (and sanity-checked against Groq). */
export function confidenceFromCandidates(
  candidates: RankedCandidate[],
  usedMemory: boolean,
): number {
  if (!usedMemory || candidates.length === 0) return 0.22;
  const top = candidates[0];
  const raw = 0.2 + 0.5 * top.score + 0.3 * top.successRate;
  return Math.round(Math.min(0.95, Math.max(0.05, raw)) * 100) / 100;
}
