/**
 * Shared domain types for the Adaptive Incident Response Agent.
 * The Incident shape follows the data model specified for the project.
 */

export type Severity = "critical" | "high" | "medium" | "low";

/** A production incident reported through the dashboard. */
export interface Incident {
  id: string;
  timestamp: string;
  service: string;
  error: string;
  severity: Severity;
  rootCause?: string;
  resolutionSteps?: string[];
  timeToResolve?: string;
  success?: boolean;
  /** Normalized key grouping repeats of "the same" error (used for success-rate math). */
  errorSignature?: string;
  /** Short summary of the agent's suggestion, stored for the history view. */
  agentSuggestion?: string;
  /** Computed ranking score of the top candidate that produced the suggestion. */
  matchScore?: number;
  /** Whether the user submitted feedback for this incident. */
  feedbackSubmitted?: boolean;
  /** When retain() accepted the feedback (drives the "learned today" counter). */
  feedbackAt?: string;
  /** Which memory mode produced the stored suggestion ("with" | "without"). */
  memoryMode?: "with" | "without";
  /** recordId of the ranked candidate whose steps were suggested (the rated fix). */
  chosenRecordId?: string;
  /** Resolution-approach label of the chosen candidate — carried onto the live retain. */
  chosenApproach?: string;
}

/** Which implementation served memory / LLM calls (surfaced in the UI for honesty). */
export type BackendName = "hindsight" | "fallback" | "groq";

/** A raw fact returned by a recall() call, normalized across backends. */
export interface RecalledFact {
  factId: string;
  text: string;
  /** Semantic similarity in 0..1 (Hindsight `scores.semantic` / reranker, or local overlap). */
  similarity: number;
  /** Metadata persisted at retain() time (string-valued). */
  metadata: Record<string, string>;
  context?: string;
  mentionedAt?: string;
}

/** A past incident experience reconstructed from one or more recalled facts. */
export interface MemoryExperience {
  recordId: string;
  service?: string;
  severity?: string;
  error?: string;
  errorSignature?: string;
  rootCause?: string;
  resolutionSteps?: string[];
  timeToResolve?: string;
  success?: boolean;
  /** ISO timestamp of when the past incident occurred. */
  occurredAt?: string;
  /** Best semantic similarity across the facts belonging to this record. */
  similarity: number;
  /** Text of the best-matching fact (used as LLM context). */
  text: string;
  /** When this record was written into memory (fact.mentioned_at) — drives "Just learned". */
  retainedAt?: string;
  /** Where the record came from: "seed" corpus vs "live" feedback. */
  source?: string;
  /** Label of the resolution approach used — groups records by HOW they were fixed. */
  resolutionApproach?: string;
}

/** A past incident scored by the in-application ranking formula. */
export interface RankedCandidate {
  experience: MemoryExperience;
  /** (a) semantic similarity from Hindsight, normalized to 0..1 */
  semanticScore: number;
  /**
   * (b) outcome-aware success: this record's own outcome blended with the
   * aggregate over records sharing its resolution approach (see lib/scoring.ts)
   */
  successRate: number;
  /** Attempts across the resolution-approach group this success value aggregates. */
  successes: number;
  attempts: number;
  /** (c) mild recency boost, 0..1 (half-life decay — old incidents are not excluded) */
  recencyScore: number;
  ageDays: number;
  /** Final weighted score = 0.55*semantic + 0.30*successRate + 0.15*recency */
  score: number;
  rank: number;
}

/** The natural-language suggestion produced by Groq (or the local fallback). */
export interface AgentSuggestion {
  steps: string[];
  reasoning: string;
  /** 0..1 */
  confidence: number;
}

export interface BackendStatus {
  memory: BackendName;
  llm: BackendName;
  /** Human-readable detail, e.g. "Hindsight Cloud (bank: sre-incidents)". */
  memoryDetail: string;
  llmDetail: string;
  /** True when a configured backend failed at runtime and a calm fallback answered instead. */
  degraded: boolean;
  /** Optional calm degradation notice shown in the UI. */
  note?: string;
}

/** Response of POST /api/suggest. */
export interface SuggestResponse {
  incident: Incident;
  usedMemory: boolean;
  candidates: RankedCandidate[];
  suggestion: AgentSuggestion;
  backends: BackendStatus;
  /** Recall error message when memory was requested but failed (UI shows a calm notice). */
  memoryError?: string;
  timings: { recallMs: number; llmMs: number; totalMs: number };
  generatedAt: string;
}

/** Aggregated stats for one error signature (drives the "learning" confirmation UI). */
export interface SignatureStats {
  signature: string;
  successes: number;
  attempts: number;
  /** Laplace-smoothed rate. */
  rate: number;
}

/** Response of POST /api/feedback. */
export interface FeedbackResponse {
  incident: Incident;
  retained: boolean;
  stats: SignatureStats | null;
  /** Populated when retain() failed — the UI still works, memory just did not grow. */
  memoryError?: string;
  backends: BackendStatus;
}

/** Response of POST /api/rerank — a fresh recall()+ranking after feedback. */
export interface RerankResponse {
  candidates: RankedCandidate[];
  backends: BackendStatus;
  tookMs: number;
  generatedAt: string;
}

/** Cheap incident-log stats returned alongside the incident list. */
export interface IncidentListStats {
  total: number;
  learned: number;
  /** retain() calls whose feedback landed today (drives the live counter). */
  learnedToday: number;
  successes: number;
  successRate: number | null;
}

/** Response of GET /api/memory. */
export interface MemoryOverview {
  backends: BackendStatus;
  /** Total facts/units stored in the memory backend when known. */
  retainedTotal: number | null;
  /** Incidents handled by the app (local transactional log). */
  incidentCount: number;
  /** Incidents the user gave feedback on (= experiences explicitly retained). */
  learnedCount: number;
  /** success / learned across feedback-submitted incidents. */
  learnedSuccessRate: number | null;
  seeded: boolean;
  /** Recent experiences read back out of the memory backend via recall(). */
  experiences: MemoryExperience[];
}
