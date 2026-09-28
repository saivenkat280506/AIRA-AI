import { NextRequest, NextResponse } from "next/server";
import {
  createIncident,
  getIncident,
  getIncidentStats,
  listIncidents,
} from "@backend/incident-store";
import type { Severity } from "@backend/types";

/**
 * POST /api/incident — create an incident report from the dashboard form.
 * GET  /api/incident — list recent incidents, or a single one via ?id=.
 */

const SEVERITIES: Severity[] = ["critical", "high", "medium", "low"];

export async function POST(req: NextRequest) {
  try {
    const body = (await req.json()) as Record<string, unknown>;
    const service = String(body.service ?? "").trim();
    const error = String(body.error ?? "").trim();
    const severity = String(body.severity ?? "") as Severity;
    const rawTimestamp = body.timestamp ? String(body.timestamp).trim() : "";

    if (!service || service.length > 120) {
      return NextResponse.json(
        { error: "Service name is required (max 120 chars)." },
        { status: 400 },
      );
    }
    if (!error || error.length > 4000) {
      return NextResponse.json(
        { error: "Error message / log snippet is required (max 4000 chars)." },
        { status: 400 },
      );
    }
    if (!SEVERITIES.includes(severity)) {
      return NextResponse.json(
        { error: "Severity must be one of critical, high, medium, low." },
        { status: 400 },
      );
    }
    if (rawTimestamp && Number.isNaN(Date.parse(rawTimestamp))) {
      return NextResponse.json(
        { error: "Timestamp must be a valid date." },
        { status: 400 },
      );
    }

    const incident = await createIncident({
      service,
      error,
      severity,
      timestamp: rawTimestamp || undefined,
    });

    return NextResponse.json({ incident }, { status: 201 });
  } catch (err) {
    console.error("[api/incident] create failed:", err);
    return NextResponse.json(
      { error: "Could not save the incident. Please try again." },
      { status: 500 },
    );
  }
}

export async function GET(req: NextRequest) {
  try {
    const id = req.nextUrl.searchParams.get("id");
    if (id) {
      const incident = await getIncident(id);
      if (!incident) {
        return NextResponse.json({ error: "Incident not found." }, { status: 404 });
      }
      return NextResponse.json({ incident });
    }

    const limitParam = Number(req.nextUrl.searchParams.get("limit") ?? "25");
    const limit = Number.isFinite(limitParam) ? Math.min(100, Math.max(1, limitParam)) : 25;
    const [incidents, stats] = await Promise.all([
      listIncidents(limit),
      getIncidentStats(),
    ]);
    return NextResponse.json({ incidents, stats });
  } catch (err) {
    console.error("[api/incident] read failed:", err);
    return NextResponse.json(
      { error: "Could not load incidents." },
      { status: 500 },
    );
  }
}
