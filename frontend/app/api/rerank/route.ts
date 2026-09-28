import { NextRequest, NextResponse } from "next/server";
import { getIncident } from "@backend/incident-store";
import { buildCandidates, getMemoryBackend } from "@backend/memory";
import { buildBackendStatus } from "@backend/status";
import type { RerankResponse } from "@backend/types";

/**
 * POST /api/rerank — the "watch it change" call.
 *
 * After feedback retain() succeeds, the client re-runs recall()+ranking for the
 * same incident and diffs the fresh list against the pre-feedback snapshot it
 * kept in component state, so the UI can show exactly what the feedback moved
 * (success rate, rank) without a second Hindsight round-trip for the "before".
 */
export async function POST(req: NextRequest) {
  const started = Date.now();
  try {
    const body = (await req.json()) as Record<string, unknown>;
    const incidentId = String(body.incidentId ?? "");
    if (!incidentId) {
      return NextResponse.json({ error: "incidentId is required." }, { status: 400 });
    }

    const incident = await getIncident(incidentId);
    if (!incident) {
      return NextResponse.json({ error: "Incident not found." }, { status: 404 });
    }

    const backend = getMemoryBackend();
    try {
      // The reveal must show the rated fix and the just-retained record even
      // if the similarity cut would have evicted them after the new retain.
      const candidates = await buildCandidates(incident, backend, {
        ensureRecordIds: [
          incident.chosenRecordId,
          `live-${incident.id}`,
        ].filter((v): v is string => Boolean(v)),
      });
      const response: RerankResponse = {
        candidates,
        backends: buildBackendStatus({ degraded: false }),
        tookMs: Date.now() - started,
        generatedAt: new Date().toISOString(),
      };
      return NextResponse.json(response);
    } catch (err) {
      console.error("[api/rerank] recall failed:", err);
      return NextResponse.json(
        {
          error: `Re-ranking failed (${err instanceof Error ? err.message : "unknown error"})`,
        },
        { status: 502 },
      );
    }
  } catch (err) {
    console.error("[api/rerank] failed:", err);
    return NextResponse.json(
      { error: "Could not recompute rankings. Please try again." },
      { status: 500 },
    );
  }
}
