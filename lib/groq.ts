import Groq from "groq-sdk";
import { env } from "@/lib/env";
import {
  buildGenericSuggestion,
  buildMemorySuggestion,
} from "@/lib/demo-fallback";
import { confidenceFromCandidates } from "@/lib/scoring";
import type { AgentSuggestion, Incident, RankedCandidate } from "@/lib/types";

/**
 * Groq integration — used ONLY to phrase the final suggestion and reasoning
 * in natural language. Ranking is done in application code (lib/scoring.ts)
 * and the already-ranked candidates are simply handed over as context.
 *
 * Every call is wrapped: on missing key, timeout, rate limit or malformed
 * output we fall back to a deterministic local generator and flag `degraded`
 * so the UI can show a calm notice instead of hanging.
 */

export interface GenerateInput {
  incident: Incident;
  candidates: RankedCandidate[];
  useMemory: boolean;
}

export interface GenerateOutput {
  suggestion: AgentSuggestion;
  provider: "groq" | "fallback";
  degraded: boolean;
  error?: string;
  ms: number;
}

const SYSTEM_PROMPT = `You are AIRA (Adaptive Incident Response Agent), an SRE incident-response copilot for production teams.

You always respond with STRICT JSON only, no markdown fences, shaped exactly as:
{"steps": ["action 1", "action 2", ...], "reasoning": "2-4 sentences", "confidence": 0.0}

Rules for the fields:
- "steps": 3 to 6 imperative, concrete actions an on-call engineer can execute right now. Be specific (names, thresholds, commands where relevant).
- "reasoning": 2-4 sentences addressed to the incident commander. When past incidents are provided you MUST reference them explicitly by number, date and service (e.g. "#1 checkout-api on 2026-08-03..."), explain why the chosen approach was picked, and — if any past incident failed — name at least one FAILURE candidate by number, date and service and state plainly that its approach failed so it is not repeated.
- "confidence": number between 0 and 1, calibrated to the quality of the evidence you were given. Reserve 0.9+ for answers grounded in a resolution of this exact incident from the last few days; strong-but-older matches belong in the 0.7-0.88 range.`;

function formatDate(iso: string | undefined): string {
  if (!iso) return "unknown";
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "unknown" : d.toISOString().slice(0, 10);
}

function buildUserPrompt(input: GenerateInput): string {
  const { incident, candidates, useMemory } = input;

  const current = [
    "CURRENT INCIDENT",
    `service: ${incident.service}`,
    `severity: ${incident.severity}`,
    `reported at: ${incident.timestamp}`,
    `error signature: ${incident.errorSignature ?? "unspecified"}`,
    `error: ${incident.error}`,
  ].join("\n");

  if (!useMemory) {
    return `${current}

MEMORY IS DISABLED FOR THIS RUN.
No past incidents are available. Do NOT reference, invent or imply any past incidents or team history. Give solid generic first-principles SRE guidance for this incident, and keep confidence at or below 0.35 because nothing is grounded in this team's experience.

Return the JSON now.`;
  }

  if (candidates.length === 0) {
    return `${current}

MEMORY IS ENABLED, but recall returned NO similar past incidents for this error signature.
Say plainly that no matching history was found, give careful generic triage steps, and keep confidence low (<= 0.35).

Return the JSON now.`;
  }

  const ranked = candidates
    .map((c) => {
      const e = c.experience;
      const lines = [
        `#${c.rank} score=${c.score.toFixed(2)} | semantic=${c.semanticScore.toFixed(2)} | success=${c.successRate.toFixed(2)} (own outcome ${e.success === true ? "SUCCESS" : e.success === false ? "FAILURE" : "UNKNOWN"}, resolution-approach group ${c.successes}/${c.attempts}) | signature="${e.errorSignature ?? "unknown"}" | recency=${c.recencyScore.toFixed(2)} | occurred=${formatDate(e.occurredAt)} (${Math.round(c.ageDays)}d ago) | service=${e.service} | time-to-resolve=${e.timeToResolve ?? "unknown"}`,
        `   root cause: ${e.rootCause ?? "unknown"}`,
        `   resolution steps: ${(e.resolutionSteps ?? ["not recorded"]).join(" ; ")}`,
      ];
      return lines.join("\n");
    })
    .join("\n");

  return `${current}

RANKED PAST INCIDENTS FROM HINDSIGHT LONG-TERM MEMORY
(retrieved by recall(), scored by the application with 0.55*semantic + 0.30*success-rate + 0.15*recency — the order below is final, do NOT re-rank and do NOT invent other incidents):

${ranked}

Instructions:
- Ground the resolution steps primarily in the HIGHEST-RANKED candidate whose outcome is SUCCESS: adapt its proven resolution steps to the current incident.
- If the #1 candidate's outcome is FAILURE, state that in the reasoning and ground the steps in the highest-ranked SUCCESSFUL candidate instead; explicitly warn against the failed approach.
- The reasoning MUST cite candidates by number, date and service, and mention the ranking components that made the difference (semantic / success rate / recency).
- If the list contains any FAILURE candidate (own outcome FAILURE), the reasoning MUST also name at least one of them by #, date and service and warn explicitly against repeating its approach (e.g. restart-only failed on that date).

Return the JSON now.`;
}

/** Coerce whatever Groq returned into a well-formed AgentSuggestion. */
function parseSuggestion(raw: string): AgentSuggestion | null {
  let text = raw.trim();
  // Strip markdown fences if the model added them anyway.
  text = text.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/i, "");

  let data: unknown = null;
  try {
    data = JSON.parse(text);
  } catch {
    const match = text.match(/\{[\s\S]*\}/);
    if (match) {
      try {
        data = JSON.parse(match[0]);
      } catch {
        return null;
      }
    }
  }

  if (!data || typeof data !== "object") return null;
  const obj = data as Record<string, unknown>;

  const steps = Array.isArray(obj.steps)
    ? obj.steps.filter((s): s is string => typeof s === "string").map((s) => s.trim()).filter(Boolean)
    : typeof obj.steps === "string"
      ? [obj.steps]
      : [];
  const reasoning =
    typeof obj.reasoning === "string" && obj.reasoning.trim().length > 0
      ? obj.reasoning.trim()
      : "";

  if (steps.length === 0 || reasoning.length === 0) return null;

  let confidence = typeof obj.confidence === "number" ? obj.confidence : 0.5;
  if (!Number.isFinite(confidence)) confidence = 0.5;
  confidence = Math.min(1, Math.max(0, confidence));

  return { steps, reasoning, confidence };
}

async function callGroqOnce(input: GenerateInput): Promise<AgentSuggestion> {
  const groq = new Groq({
    apiKey: env.groqApiKey,
    timeout: 25_000, // fail over fast during a live demo
    maxRetries: 1,
  });

  const completion = await groq.chat.completions.create({
    model: env.groqModel,
    temperature: 0.2,
    max_completion_tokens: 3000, // headroom so long reasoning can't truncate the JSON
    response_format: { type: "json_object" },
    messages: [
      { role: "system", content: SYSTEM_PROMPT },
      { role: "user", content: buildUserPrompt(input) },
    ],
  });

  const content = completion.choices[0]?.message?.content ?? "";
  const parsed = parseSuggestion(content);
  if (!parsed) {
    throw new Error("Groq returned a malformed suggestion payload");
  }
  return parsed;
}

async function callGroq(input: GenerateInput): Promise<AgentSuggestion> {
  try {
    return await callGroqOnce(input);
  } catch (err) {
    // One quick retry — malformed payloads are usually truncated output.
    if (err instanceof Error && err.message.includes("malformed")) {
      return await callGroqOnce(input);
    }
    throw err;
  }
}

/**
 * Calibration guards applied to every suggestion before it ships.
 *   - without memory: never confidently claim more than 0.4
 *   - with memory: no near-certainty (0.88+) unless some recalled resolution is
 *     fresh (≤ 3 days old) — stale evidence cannot justify certainty, and a
 *     same-day prior resolution of this exact incident legitimately can.
 */
function calibrate(
  suggestion: AgentSuggestion,
  useMemory: boolean,
  candidates: RankedCandidate[],
): void {
  if (!useMemory && suggestion.confidence > 0.4) suggestion.confidence = 0.4;
  if (useMemory && candidates.length > 0) {
    const freshest = Math.min(...candidates.map((c) => c.ageDays));
    if (freshest > 3 && suggestion.confidence > 0.88) {
      suggestion.confidence = 0.88;
    }
  }
}

/**
 * Generate the agent's suggestion. Never throws — always returns a usable
 * suggestion (live Groq or deterministic fallback) plus degradation info.
 */
export async function generateSuggestion(
  input: GenerateInput,
): Promise<GenerateOutput> {
  const started = Date.now();
  const { incident, candidates, useMemory } = input;

  const localFallback = () =>
    useMemory
      ? buildMemorySuggestion(incident, candidates)
      : buildGenericSuggestion(incident);

  if (!env.groqConfigured) {
    const suggestion = localFallback();
    calibrate(suggestion, useMemory, candidates);
    return {
      suggestion,
      provider: "fallback",
      degraded: false,
      ms: Date.now() - started,
    };
  }

  try {
    const suggestion = await callGroq(input);
    calibrate(suggestion, useMemory, candidates);
    return {
      suggestion,
      provider: "groq",
      degraded: false,
      ms: Date.now() - started,
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[groq] call failed, using local fallback:", message);
    const fallback = localFallback();
    // If the LLM failed on the memory path, keep confidence tied to real scores.
    if (useMemory && candidates.length > 0) {
      fallback.confidence = confidenceFromCandidates(candidates, true);
    }
    calibrate(fallback, useMemory, candidates);
    return {
      suggestion: fallback,
      provider: "fallback",
      degraded: true,
      error: message,
      ms: Date.now() - started,
    };
  }
}
