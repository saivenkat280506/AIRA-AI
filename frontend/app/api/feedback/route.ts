import { NextRequest, NextResponse } from "next/server";
import { getIncident, updateIncident } from "@backend/incident-store";
import {
  getMemoryBackend,
  getSignatureStats,
  retainExperience,
} from "@backend/memory";
import { buildBackendStatus } from "@backend/status";
import type { FeedbackResponse } from "@backend/types";

/**
 * POST /api/feedback — the learning step.
 *
 *   "This fixed it"     → retain the full experience with success=true
 *   "This did not help" → retain with success=false (kept on purpose so the
 *                          fix's future success rate goes DOWN, never discarded)
 *
 * Both outcomes are written into Hindsight; local incident state is updated
 * even if the retain fails (calm degradation, `retained:false` + memoryError).
 */
export async function POST(req: NextRequest) {
  try {
    const body = (await req.json()) as Record<string, unknown>;
    const incidentId = String(body.incidentId ?? "");
    const success = body.success;

    if (!incidentId) {
      return NextResponse.json({ error: "incidentId is required." }, { status: 400 });
    }
    if (typeof success !== "boolean") {
      return NextResponse.json(
        { error: "success must be true or false." },
        { status: 400 },
      );
    }

    const rootCause = body.rootCause ? String(body.rootCause).trim().slice(0, 2000) : undefined;
    const timeToResolve = body.timeToResolve
      ? String(body.timeToResolve).trim().slice(0, 120)
      : undefined;
    const resolutionSteps = Array.isArray(body.resolutionSteps)
      ? body.resolutionSteps
          .filter((s): s is string => typeof s === "string")
          .map((s) => s.trim())
          .filter(Boolean)
          .slice(0, 12)
      : undefined;

    const existing = await getIncident(incidentId);
    if (!existing) {
      return NextResponse.json({ error: "Incident not found." }, { status: 404 });
    }

    // 1) Update the local transactional record.
    const incident = await updateIncident(incidentId, {
      success,
      feedbackSubmitted: true,
      ...(rootCause ? { rootCause } : {}),
      ...(timeToResolve ? { timeToResolve } : {}),
      ...(resolutionSteps && resolutionSteps.length > 0 ? { resolutionSteps } : {}),
    });
    if (!incident) {
      return NextResponse.json({ error: "Incident not found." }, { status: 404 });
    }

    // 2) Retain the experience into the memory backend (Hindsight in prod).
    const backend = getMemoryBackend();
    let retained = true;
    let memoryError: string | undefined;
    try {
      await retainExperience(
        {
          incident,
          success,
          rootCause,
          timeToResolve,
          resolutionSteps,
          suggestion: {
            steps: resolutionSteps ?? [],
            reasoning: "",
            confidence: 0,
          },
        },
        backend,
      );
    } catch (err) {
      retained = false;
      memoryError = err instanceof Error ? err.message : String(err);
      console.error("[api/feedback] retain failed:", err);
    }

    // 2b) Stamp the retain() event — this is what the "learned today" counter counts.
    let finalIncident = incident;
    if (retained) {
      const stamped = await updateIncident(incidentId, {
        feedbackAt: new Date().toISOString(),
      });
      if (stamped) finalIncident = stamped;
    }

    // 3) Recompute this signature's stats so the UI can show the learning effect.
    const stats = incident.errorSignature
      ? await getSignatureStats(incident.errorSignature, backend)
      : null;

    const response: FeedbackResponse = {
      incident: finalIncident,
      retained,
      stats,
      memoryError,
      backends: buildBackendStatus({
        degraded: !retained,
        note: retained
          ? undefined
          : `Feedback saved locally, but memory write failed (${memoryError ?? "unknown error"})`,
      }),
    };

    return NextResponse.json(response);
  } catch (err) {
    console.error("[api/feedback] failed:", err);
    return NextResponse.json(
      { error: "Could not save feedback. Please try again." },
      { status: 500 },
    );
  }
}
