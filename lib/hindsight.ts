import { HindsightClient, HindsightError } from "@vectorize-io/hindsight-client";
import { env } from "@/lib/env";
import type { RecalledFact } from "@/lib/types";

/**
 * Hindsight (by Vectorize) client wrapper — the ONLY memory system in AIRA.
 *
 * Responsibilities:
 *   retain()  – persist an incident experience (incident + suggestion + outcome)
 *   recall()  – fetch similar past incidents for a new report
 *   scoring   – re-exported from lib/scoring.ts; ranking happens HERE in the
 *               application, never inside the LLM.
 *
 * All calls are defensive: they throw typed Errors that callers catch and
 * convert into calm, visible error states.
 */

let client: HindsightClient | null = null;
/** Bank is created once per process; failures are retried on the next call. */
let bankReady: Promise<void> | null = null;

export function hindsightConfigured(): boolean {
  return env.hindsightConfigured;
}

export function getHindsightClient(): HindsightClient {
  if (!hindsightConfigured()) {
    throw new Error(
      "Hindsight is not configured (set HINDSIGHT_API_KEY, or use the local fallback backend).",
    );
  }
  if (!client) {
    client = new HindsightClient({
      baseUrl: env.hindsightBaseUrl,
      apiKey: env.hindsightApiKey,
    });
  }
  return client;
}

/** Idempotently provision the memory bank (create-or-update, once per process). */
async function ensureBank(): Promise<void> {
  if (!bankReady) {
    bankReady = getHindsightClient()
      .createBank(env.bankId, {
        reflectMission:
          "Recall SRE incident experiences. Prefer facts with matching service and error signature, " +
          "higher historical success rates, and recent timestamps.",
      })
      .then(() => undefined)
      .catch((err) => {
        bankReady = null;
        throw err;
      });
  }
  return bankReady;
}

/** A record to be written into Hindsight with structured, parse-friendly content. */
export interface RetainRecord {
  /** Stable id shared by every fact extracted from this record. */
  recordId: string;
  content: string;
  context?: string;
  metadata: Record<string, string>;
  timestamp: string;
}

/**
 * Retain one experience into Hindsight.
 * Content is deliberately structured (`Field: value` lines) so the recalled
 * facts can be re-parsed into an Incident even if metadata is dropped.
 */
export async function hindsightRetain(record: RetainRecord): Promise<void> {
  await ensureBank();
  const c = getHindsightClient();
  await c.retain(env.bankId, record.content, {
    context: record.context,
    metadata: record.metadata,
    timestamp: record.timestamp,
    tags: ["incident"],
  });
}

/**
 * Recall memories for a natural-language query.
 * Maps Hindsight's RecallResult onto our backend-agnostic RecalledFact:
 *   similarity = scores.semantic (0..1 cosine) ?? scores.reranker ?? scores.final
 */
export async function hindsightRecall(
  query: string,
  options: { maxTokens?: number } = {},
): Promise<RecalledFact[]> {
  await ensureBank();
  const c = getHindsightClient();
  const res = await c.recall(env.bankId, query, {
    maxTokens: options.maxTokens ?? 4096,
    budget: "high",
    types: ["world", "experience", "observation"],
  });

  return (res.results ?? []).map((r) => {
    const s = r.scores;
    const similarity =
      s?.semantic ?? s?.reranker ?? (s?.final !== undefined ? clamp01(s.final) : 0);
    return {
      factId: r.id,
      text: r.text ?? "",
      similarity: clamp01(similarity),
      metadata: r.metadata ?? {},
      context: r.context ?? undefined,
      mentionedAt: r.mentioned_at ?? undefined,
    };
  });
}

/** Total facts stored in the bank (best-effort; null when unavailable). */
export async function hindsightMemoryCount(): Promise<number | null> {
  try {
    await ensureBank();
    const c = getHindsightClient();
    const res = await c.listMemories(env.bankId, { limit: 1 });
    return res.total ?? null;
  } catch {
    return null;
  }
}

function clamp01(n: number): number {
  if (!Number.isFinite(n)) return 0;
  return Math.min(1, Math.max(0, n));
}

/** Human-friendly error message for UI error states. */
export function describeHindsightError(err: unknown): string {
  if (err instanceof HindsightError) {
    return `Hindsight error${err.statusCode ? ` (${err.statusCode})` : ""}: ${err.message}`;
  }
  if (err instanceof Error) return err.message;
  return "Unknown Hindsight error";
}

// Re-export the application-side scoring formula (spec: recall + retain + scoring
// live behind this module) so callers have a single import surface.
export {
  SCORE_WEIGHTS,
  RECENCY_HALF_LIFE_DAYS,
  rankCandidates,
  successRate,
  recencyScore,
} from "@/lib/scoring";
