import type { AgentSuggestion, Incident, RankedCandidate } from "@/lib/types";
import { confidenceFromCandidates } from "@/lib/scoring";

/**
 * Hardcoded/canned suggestions — the reliability safety net.
 *
 * Used when GROQ_API_KEY is missing, GROQ_BACKEND=fallback/DEMO_FALLBACK=1,
 * or a live Groq call fails mid-demo. The rehearsed scenario (Redis connection
 * timeout) has an exact pre-written response; everything else is templated
 * from the already-ranked candidates, so the memory story still reads correctly
 * with zero network dependency.
 */

/** The exact incident the demo is rehearsed around. */
export function isRehearsedScenario(incident: Incident): boolean {
  const service = incident.service.toLowerCase();
  const error = incident.error.toLowerCase();
  return (
    (service === "checkout-api" || service === "payments-api" || service === "search-api") &&
    error.includes("redis") &&
    (error.includes("timeout") || error.includes("etimedout") || error.includes("econnreset"))
  );
}

/** Generic, honest, first-principles advice — what the agent says with memory OFF. */
export function buildGenericSuggestion(incident: Incident): AgentSuggestion {
  return {
    steps: [
      `Check the last deploys, config changes and scaling events for ${incident.service} around the incident timestamp.`,
      `Grep application and platform logs for the exact error and its neighbours in the 10 minutes before it appeared.`,
      `Verify dependencies ${incident.service} talks to (databases, caches, brokers, DNS) — health, saturation and connection-pool metrics.`,
      `Correlate with dashboards: latency, error rate, saturation; look for a burst that matches the failure window.`,
      `Roll back the most recent change if correlation is strong; otherwise restart/replicate the affected component and watch for recurrence.`,
      `Escalate with a structured timeline if the error persists beyond 15 minutes of these checks.`,
    ],
    reasoning:
      "Memory is disabled for this run, so no past incidents were retrieved. This is generic first-principles SRE guidance, not grounded in your team's history — treat it as a starting checklist rather than a proven fix.",
    confidence: 0.22,
  };
}

/**
 * Memory-grounded suggestion built directly from the ranked candidates.
 * References candidates explicitly (#1, #2 …) with dates, root causes and
 * outcomes so the "chosen among multiple past candidates" story is visible
 * even when Groq is unavailable.
 */
export function buildMemorySuggestion(
  incident: Incident,
  candidates: RankedCandidate[],
): AgentSuggestion {
  if (candidates.length === 0) {
    return {
      steps: [
        `No strongly matching past incidents were recalled for this error signature — fall back to standard triage for ${incident.service}.`,
        "Check recent deploys and config changes, then dependency health and saturation.",
        "Capture the outcome: your feedback will retain this incident so the next similar report is answered from experience.",
      ],
      reasoning:
        "Memory was queried but returned no similar past incidents, so there is nothing proven to draw from yet. The suggestion is generic triage; submitting feedback will store this incident and improve future recalls.",
      confidence: 0.3,
    };
  }

  const top = candidates[0];
  const proven = candidates.find((c) => c.experience.success === true) ?? top;
  const failed = candidates.filter((c) => c.experience.success === false);
  const e = proven.experience;

  const short = (c: RankedCandidate, n: number) =>
    `#${n} ${c.experience.service} (${formatDate(c.experience.occurredAt)}, score ${c.score.toFixed(2)})`;

  if (isRehearsedScenario(incident)) {
    return {
      steps: [
        "Raise the Redis client connection pool (maxConnections) from its current value to ~512 — every prior occurrence of this signature was pool exhaustion.",
        "Enable exponential-backoff reconnect with jitter (do not rely on the offline command queue alone).",
        "Set a hard pool-wait cap (~2s) and shed load with 503 rather than letting requests block to the 30s client timeout.",
        "Add a pool-utilization alarm at 70% and a dashboard panel for pool wait time.",
        "Confirm with a load test against the cache tier before closing the incident; retain the outcome to update this fix's success rate.",
      ],
      reasoning: buildReasoning(incident, candidates, proven, failed),
      confidence: confidenceFromCandidates(candidates, true),
    };
  }

  const steps = (e.resolutionSteps ?? []).map((s) => `${s} (proven on ${e.service}, ${formatDate(e.occurredAt)})`);
  if (steps.length === 0) {
    steps.push(
      `Apply standard triage for ${incident.service}, then retain your feedback so this signature builds history.`,
    );
  }
  if (failed.length > 0) {
    steps.push(
      `Do not repeat: ${failed[0].experience.resolutionSteps?.[0] ?? "the previous partial fix"} — recorded as ${short(failed[0], candidates.indexOf(failed[0]) + 1)}, it did not hold.`,
    );
  }

  return {
    steps,
    reasoning: buildReasoning(incident, candidates, proven, failed),
    confidence: confidenceFromCandidates(candidates, true),
  };
}

function buildReasoning(
  incident: Incident,
  candidates: RankedCandidate[],
  proven: RankedCandidate,
  failed: RankedCandidate[],
): string {
  const top = candidates[0];
  const topE = top.experience;
  const pE = proven.experience;
  const parts: string[] = [];

  parts.push(
    `Ranked ${candidates.length} past incidents from memory using the weighted score (0.55·similarity + 0.30·success rate + 0.15·recency). ` +
      `${shortDesc(top)} came first at ${top.score.toFixed(2)} — semantic ${top.semanticScore.toFixed(2)}, ` +
      `success ${top.successes}/${top.attempts} in its resolution-approach group for “${topE.errorSignature ?? "unknown signature"}”, ` +
      `recency ${top.recencyScore.toFixed(2)}.`,
  );

  if (proven.experience.recordId !== top.experience.recordId) {
    parts.push(
      `I'm grounding the steps in ${shortDesc(proven)} instead, because ${shortDesc(top)}'s recorded outcome was a failure — its resolution did not hold, so only its diagnosis is useful here.`,
    );
  } else {
    parts.push(
      `Its resolution succeeded (${pE.timeToResolve ?? "n/a"}), so the steps come straight from that proven fix, adapted to the current report.`,
    );
  }

  if (failed.length > 0) {
    parts.push(
      `Rejected approach: ${shortDesc(failed[0])} — recorded as a failed resolution (${failed[0].experience.rootCause ?? "root cause unresolved"}), so it is explicitly avoided.`,
    );
  }

  const others = candidates.slice(1, 3).map((c) => shortDesc(c, c.rank));
  if (others.length > 0) {
    parts.push(`Also considered: ${others.join("; ")}.`);
  }

  if (incident.errorSignature && topE.errorSignature) {
    parts.push(`Drawn from incident record ${pE.recordId}.`);
  }

  return parts.join(" ");
}

function shortDesc(c: RankedCandidate, n = c.rank): string {
  const e = c.experience;
  return `#${n} ${e.service} (${formatDate(e.occurredAt)})`;
}

function formatDate(iso: string | undefined): string {
  if (!iso) return "unknown date";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "unknown date";
  return d.toISOString().slice(0, 10);
}
