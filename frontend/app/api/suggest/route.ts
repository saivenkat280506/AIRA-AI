import { NextRequest, NextResponse } from "next/server";
import {
  getIncident,
  parseIncident,
  updateIncident,
  upsertIncident,
} from "@backend/incident-store";
import { readIncidentCookie, setIncidentCookie } from "@backend/incident-session";
import {
  buildCandidates,
  getMemoryBackend,
} from "@backend/memory";
import { generateSuggestion } from "@backend/groq";
import { buildBackendStatus } from "@backend/status";
import type { RankedCandidate, SuggestResponse } from "@backend/types";

/**
 * POST /api/suggest — the core agent call.
 *
 *   useMemory=true  → Hindsight recall() → application-side ranking → Groq phrasing
 *   useMemory=false → recall skipped entirely, empty context → generic answer
 *
 * The two modes run the SAME model with the same incident; only the memory
 * context differs — which is exactly what the with/without toggle compares.
 */
export async function POST(req: NextRequest) {
  const started = Date.now();
  try {
    const body = (await req.json()) as Record<string, unknown>;
    const incidentId = String(body.incidentId ?? "");
    const useMemory = body.useMemory !== false;

    if (!incidentId) {
      return NextResponse.json({ error: "incidentId is required." }, { status: 400 });
    }

    const incident =
      (await getIncident(incidentId)) ??
      parseIncident(body.incident, incidentId) ??
      readIncidentCookie(req, incidentId);
    if (!incident) {
      return NextResponse.json({ error: "Incident not found." }, { status: 404 });
    }

    const backend = getMemoryBackend();

    // 1) Recall similar past incidents (skipped entirely when memory is off).
    let candidates: RankedCandidate[] = [];
    let memoryError: string | undefined;
    const recallStart = Date.now();
    if (useMemory) {
      try {
        candidates = await buildCandidates(incident, backend);
      } catch (err) {
        memoryError = err instanceof Error ? err.message : String(err);
        console.error("[api/suggest] recall failed, continuing without memory:", err);
      }
    }
    const recallMs = Date.now() - recallStart;

    // 2) Groq phrases the suggestion from the already-ranked candidates.
    const generated = await generateSuggestion({ incident, candidates, useMemory });

    // 3) Persist a compact summary so the history view shows what was suggested.
    //    The chosen candidate (whose steps Groq was told to ground the fix in)
    //    is recorded so feedback can rate THE fix that was actually suggested.
    //    Keys are omitted (not set to undefined) so the parallel without-memory
    //    run cannot clobber them.
    const chosen = useMemory && !memoryError ? candidates[0] : undefined;
    const nextIncident: typeof incident = {
      ...incident,
      agentSuggestion: generated.suggestion.steps.slice(0, 4).join(" | "),
      memoryMode: useMemory ? "with" : "without",
      ...(chosen ? { matchScore: chosen.score } : {}),
      ...(chosen?.experience.recordId ? { chosenRecordId: chosen.experience.recordId } : {}),
      ...(chosen?.experience.resolutionApproach
        ? { chosenApproach: chosen.experience.resolutionApproach }
        : {}),
    };
    const stored = await updateIncident(incident.id, nextIncident);
    const responseIncident = stored ?? (await upsertIncident(nextIncident));

    const response: SuggestResponse = {
      incident: responseIncident,
      usedMemory: useMemory && !memoryError,
      candidates,
      suggestion: generated.suggestion,
      backends: buildBackendStatus({
        llmProvider: generated.provider,
        degraded: generated.degraded || Boolean(memoryError),
        note: generated.degraded
          ? `Groq unavailable — used local fallback (${generated.error ?? "unknown error"})`
          : memoryError
            ? `Memory recall failed — answered without memory (${memoryError})`
            : undefined,
      }),
      memoryError,
      timings: { recallMs, llmMs: generated.ms, totalMs: Date.now() - started },
      generatedAt: new Date().toISOString(),
    };

    const nextResponse = NextResponse.json(response);
    return setIncidentCookie(nextResponse, responseIncident);
  } catch (err) {
    console.error("[api/suggest] failed:", err);
    return NextResponse.json(
      { error: "The agent could not generate a suggestion. Please try again." },
      { status: 500 },
    );
  }
}
