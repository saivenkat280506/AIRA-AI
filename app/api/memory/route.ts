import { NextResponse } from "next/server";
import { getIncidentStats } from "@/lib/incident-store";
import { getMemoryBackend, recallRecentExperiences } from "@/lib/memory";
import { buildBackendStatus } from "@/lib/status";
import type { MemoryOverview } from "@/lib/types";

/**
 * GET /api/memory — memory overview for the Memory page and header badges:
 * backend status, how many experiences are retained, and a live recall()
 * showing what the agent currently remembers.
 */
export async function GET() {
  try {
    const backend = getMemoryBackend();
    const stats = await getIncidentStats();

    let retainedTotal: number | null = null;
    let seeded = false;
    let experiences: MemoryOverview["experiences"] = [];
    let degraded = false;
    let note: string | undefined;

    try {
      retainedTotal = await backend.count();
      seeded = await backend.seeded();
    } catch (err) {
      console.error("[api/memory] count failed:", err);
      degraded = true;
    }

    try {
      experiences = await recallRecentExperiences(backend, 20);
    } catch (err) {
      console.error("[api/memory] recall failed:", err);
      degraded = true;
      note = `Memory recall failed (${err instanceof Error ? err.message : "unknown error"})`;
    }

    const response: MemoryOverview = {
      backends: buildBackendStatus({ degraded, note }),
      retainedTotal,
      incidentCount: stats.total,
      learnedCount: stats.learned,
      learnedSuccessRate: stats.successRate,
      seeded,
      experiences,
    };

    return NextResponse.json(response);
  } catch (err) {
    console.error("[api/memory] failed:", err);
    return NextResponse.json(
      { error: "Could not load memory overview." },
      { status: 500 },
    );
  }
}
