import { promises as fs } from "node:fs";
import path from "node:path";
import { env } from "./env";
import {
  hindsightConfigured,
  hindsightMemoryCount,
  hindsightRecall,
  hindsightRetain,
  type RetainRecord,
} from "./hindsight";
import {
  fallbackCount,
  fallbackIsSeeded,
  fallbackRecall,
  fallbackRetain,
} from "./fallback-memory";
import { buildExperienceRecord, parseStructuredText, type ExperienceInput } from "./records";
import { rankCandidates, successRate } from "./scoring";
import type {
  MemoryExperience,
  RankedCandidate,
  RecalledFact,
  SignatureStats,
} from "./types";

/**
 * Memory orchestration: backend selection, recall parsing, and the
 * application-side ranking pipeline (semantic + success rate + recency).
 *
 * Nothing here calls the LLM — Groq only ever phrases the final suggestion
 * from candidates that are already ranked.
 */

export interface RecallOptions {
  maxTokens?: number;
  limit?: number;
}

export interface MemoryBackendHandle {
  name: "hindsight" | "fallback";
  detail: string;
  retain(records: RetainRecord[]): Promise<void>;
  recall(query: string, opts?: RecallOptions): Promise<RecalledFact[]>;
  count(): Promise<number | null>;
  /** Whether the demo seed corpus is present in this backend. */
  seeded(): Promise<boolean>;
}

const HINDSIGHT_SEED_MARKER = path.join(process.cwd(), ".data", "hindsight-seeded.json");

/**
 * Resolve the active memory backend.
 * auto → Hindsight Cloud when HINDSIGHT_API_KEY is set, otherwise the local
 * fallback (which ships with the same seed corpus so the demo always runs).
 */
export function getMemoryBackend(): MemoryBackendHandle {
  const pref = env.memoryPreference;
  const useHindsight = pref === "hindsight" || (pref === "auto" && env.hindsightConfigured);

  if (useHindsight) {
    return {
      name: "hindsight",
      detail: `Hindsight Cloud · bank “${env.bankId}”`,
      // Sequential retains keep us clear of per-key rate limits.
      retain: async (records) => {
        for (const r of records) await hindsightRetain(r);
      },
      recall: hindsightRecall,
      count: hindsightMemoryCount,
      seeded: async () => {
        try {
          await fs.access(HINDSIGHT_SEED_MARKER);
          return true;
        } catch {
          return false;
        }
      },
    };
  }

  return {
    name: "fallback",
    detail: "Local fallback memory · bundled seed corpus",
    retain: fallbackRetain,
    recall: fallbackRecall,
    count: fallbackCount,
    seeded: fallbackIsSeeded,
  };
}

/** Record that the Hindsight bank contains the demo corpus (written by the seed script). */
export async function markHindsightSeeded(count: number): Promise<void> {
  await fs.mkdir(path.dirname(HINDSIGHT_SEED_MARKER), { recursive: true });
  await fs.writeFile(
    HINDSIGHT_SEED_MARKER,
    JSON.stringify({ seededAt: new Date().toISOString(), count }, null, 2),
    "utf8",
  );
}

const STOPWORDS = new Set([
  "a", "an", "the", "to", "of", "in", "on", "for", "and", "or", "is", "are",
  "at", "by", "with", "from", "after", "during", "when", "that", "this",
  "it", "as", "be", "been", "was", "were", "has", "have", "had", "not", "no",
]);

/**
 * Normalized key that groups repeats of "the same" error across incidents.
 * Numbers, IPs, UUIDs and hex ids are collapsed so only the shape remains.
 */
export function computeErrorSignature(service: string, error: string): string {
  const svc = service
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");

  const normalized = error
    .toLowerCase()
    .replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/g, " uuid ")
    .replace(/\b\d{1,3}(\.\d{1,3}){3}\b/g, " ip ")
    .replace(/\d+/g, " n ")
    .replace(/[^a-z0-9]+/g, " ");

  const tokens = normalized
    .split(/\s+/)
    .filter((t) => t.length > 1 && !STOPWORDS.has(t));

  const tail = tokens.slice(0, 8).join("-") || "unknown";
  return `${svc || "unknown"}:${tail}`;
}

function splitSteps(raw: string | undefined): string[] | undefined {
  if (!raw) return undefined;
  const steps = raw.split(" | ").map((s) => s.trim()).filter(Boolean);
  return steps.length > 0 ? steps : undefined;
}

/** Reconstruct a past incident from one recalled fact (metadata or text lines). */
export function parseFact(fact: RecalledFact): MemoryExperience | null {
  const md = fact.metadata ?? {};
  const parsed = parseStructuredText(fact.text ?? "");
  const fromContext = fact.context?.match(/^incident-record:(.+)$/)?.[1];
  const recordId = md.recordId || parsed.recordId || fromContext;
  if (!recordId) return null;

  const successRaw = md.success ?? (parsed.success !== undefined ? String(parsed.success) : undefined);

  return {
    recordId,
    service: md.service || parsed.service,
    severity: md.severity || parsed.severity,
    error: md.error || parsed.error,
    errorSignature: md.errorSignature || parsed.errorSignature,
    rootCause: md.rootCause || parsed.rootCause,
    resolutionSteps: splitSteps(md.resolutionSteps) ?? parsed.resolutionSteps,
    timeToResolve: md.timeToResolve || parsed.timeToResolve,
    success: successRaw !== undefined ? successRaw === "true" : undefined,
    occurredAt: md.occurredAt || parsed.occurredAt || fact.mentionedAt,
    retainedAt: fact.mentionedAt,
    source: md.source,
    resolutionApproach: md.resolutionApproach || parsed.resolutionApproach,
    similarity: fact.similarity,
    text: fact.text,
  };
}

/**
 * Group facts into experiences by recordId: keep the highest-similarity fact
 * as the representative and fill any fields the other facts carry.
 */
export function mergeExperiences(facts: RecalledFact[]): MemoryExperience[] {
  const byId = new Map<string, MemoryExperience>();

  for (const fact of facts) {
    const exp = parseFact(fact);
    if (!exp) continue;
    const prev = byId.get(exp.recordId);
    if (!prev) {
      byId.set(exp.recordId, exp);
      continue;
    }
    if (exp.similarity > prev.similarity) {
      byId.set(exp.recordId, { ...exp, ...fillGaps(exp, prev) });
    } else {
      byId.set(exp.recordId, { ...prev, ...fillGaps(prev, exp) });
    }
  }

  return [...byId.values()];
}

function fillGaps(
  target: MemoryExperience,
  source: MemoryExperience,
): Partial<MemoryExperience> {
  const gaps: Partial<MemoryExperience> = {};
  const keys = [
    "service", "severity", "error", "errorSignature", "rootCause",
    "resolutionApproach", "resolutionSteps", "timeToResolve", "success",
    "occurredAt",
  ] as const;
  for (const k of keys) {
    if (target[k] === undefined && source[k] !== undefined) {
      (gaps as Record<string, unknown>)[k] = source[k];
    }
  }
  return gaps;
}

/** Query handed to recall() for a new incident (what the agent "thinks about"). */
export function buildRecallQuery(incident: {
  service: string;
  error: string;
  severity: string;
  errorSignature?: string;
}): string {
  return [incident.errorSignature, incident.service, incident.error]
    .filter(Boolean)
    .join(" ");
}

interface SigCounter {
  attempts: Set<string>;
  successes: Set<string>;
}

function addToCounter(
  counters: Map<string, SigCounter>,
  key: string,
  exp: MemoryExperience,
): void {
  if (!key || !exp.recordId) return;
  let c = counters.get(key);
  if (!c) {
    c = { attempts: new Set(), successes: new Set() };
    counters.set(key, c);
  }
  c.attempts.add(exp.recordId);
  if (exp.success === true) c.successes.add(exp.recordId);
}

/**
 * Grouping key for the resolution-approach aggregate. Records with the same
 * label ("Restart the pod only", "Raise maxConnections…") pool their outcomes;
 * records without a label are their own singleton group.
 */
export function approachKey(exp: MemoryExperience): string {
  const label = exp.resolutionApproach?.trim();
  return label && label.length > 0 ? `approach:${label}` : `record:${exp.recordId}`;
}

/** Signature stats built purely from experiences we have already seen. */
function countersFromExperiences(
  exps: MemoryExperience[],
  keyOf: (e: MemoryExperience) => string,
): Map<string, SigCounter> {
  const counters = new Map<string, SigCounter>();
  for (const e of exps) addToCounter(counters, keyOf(e), e);
  return counters;
}

/**
 * Full pipeline for one incident:
 *   1. recall() similar past incidents from the memory backend
 *   2. top up success-rate stats with targeted recalls per error signature
 *   3. rank candidates with the weighted formula (lib/scoring.ts)
 *
 * Throws when the backend fails — callers render a calm error state.
 */
export async function buildCandidates(
  incident: {
    service: string;
    error: string;
    severity: string;
    errorSignature?: string;
  },
  backend: MemoryBackendHandle,
  opts: { ensureRecordIds?: string[] } = {},
): Promise<RankedCandidate[]> {
  const query = buildRecallQuery(incident);
  const facts = await backend.recall(query, { maxTokens: 6000, limit: 12 });
  const experiences = mergeExperiences(facts);
  if (experiences.length === 0) return [];

  const sigKey = (e: MemoryExperience) => e.errorSignature ?? "";
  const signatureCounters = countersFromExperiences(experiences, sigKey);
  const probedExperiences: MemoryExperience[] = [];

  // Targeted probes: make sure each candidate signature's success rate is
  // computed over the full history of that signature, not just what the
  // similarity query happened to surface. Best-effort — never fails ranking.
  // The same records also widen the approach aggregates (their approach labels
  // travel inside the recalled content/metadata).
  const signatureOrder: string[] = [];
  for (const e of [...experiences].sort((a, b) => b.similarity - a.similarity)) {
    if (e.errorSignature && !signatureOrder.includes(e.errorSignature)) {
      signatureOrder.push(e.errorSignature);
    }
  }
  const thin = signatureOrder
    .filter((sig) => (signatureCounters.get(sig)?.attempts.size ?? 0) < 3)
    .slice(0, 4);

  await Promise.all(
    thin.map(async (sig) => {
      try {
        const probeFacts = await backend.recall(
          `error signature ${sig} outcome success failure root cause resolution`,
          { maxTokens: 3000, limit: 12 },
        );
        const probed = mergeExperiences(probeFacts);
        for (const e of probed) addToCounter(signatureCounters, sigKey(e), e);
        probedExperiences.push(...probed);
      } catch {
        /* probe is best-effort */
      }
    }),
  );

  // Resolution-approach aggregates: outcomes pooled by HOW each record fixed
  // the problem (not by error signature) — this is what feeds the success
  // component of the score.
  const approachCounters = countersFromExperiences(
    [...experiences, ...probedExperiences],
    approachKey,
  );

  const topExperiences = [...experiences]
    .sort((a, b) => b.similarity - a.similarity)
    .slice(0, 6);

  // Keep records the caller cannot afford to lose — the post-feedback reveal
  // needs the rated fix and the just-retained record even when the similarity
  // cut would evict them (the fresh live record occupies a top slot). Only
  // records the recall actually returned are ever added back.
  for (const id of opts.ensureRecordIds ?? []) {
    if (!id || topExperiences.some((e) => e.recordId === id)) continue;
    const found = [...experiences, ...probedExperiences].find(
      (e) => e.recordId === id,
    );
    if (found) topExperiences.push(found);
  }

  return rankCandidates(
    topExperiences.map((exp) => {
      const c = approachCounters.get(approachKey(exp));
      return {
        experience: exp,
        semantic: exp.similarity,
        successes: c?.successes.size ?? 0,
        attempts: c?.attempts.size ?? 0,
      };
    }),
  );
}

/** Retain a feedback event (the learning step) into the active backend. */
export async function retainExperience(
  input: ExperienceInput,
  backend: MemoryBackendHandle,
): Promise<void> {
  await backend.retain([buildExperienceRecord(input)]);
}

/** Current Laplace-smoothed stats for one error signature. */
export async function getSignatureStats(
  signature: string,
  backend: MemoryBackendHandle,
): Promise<SignatureStats | null> {
  try {
    const facts = await backend.recall(
      `error signature ${signature} outcome success failure`,
      { maxTokens: 3000, limit: 20 },
    );
    const experiences = mergeExperiences(facts).filter(
      (e) => e.errorSignature === signature,
    );
    if (experiences.length === 0) return null;
    const attempts = new Set(experiences.map((e) => e.recordId));
    const successes = new Set(
      experiences.filter((e) => e.success === true).map((e) => e.recordId),
    );
    return {
      signature,
      successes: successes.size,
      attempts: attempts.size,
      rate: successRate(successes.size, attempts.size),
    };
  } catch {
    return null;
  }
}

/** Broad probe used by the Memory page to show what the backend currently holds. */
export async function recallRecentExperiences(
  backend: MemoryBackendHandle,
  limit = 20,
): Promise<MemoryExperience[]> {
  const facts = await backend.recall(
    "past production incident root cause resolution outcome",
    { maxTokens: 6000, limit },
  );
  // Recency = when the record was retained (falls back to when it happened),
  // so a just-rated incident floats straight to the top of the list.
  const recencyKey = (e: MemoryExperience) => e.retainedAt ?? e.occurredAt ?? "";
  return mergeExperiences(facts).sort((a, b) =>
    recencyKey(b).localeCompare(recencyKey(a)),
  );
}

export { hindsightConfigured };
