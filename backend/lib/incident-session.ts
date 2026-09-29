import type { NextRequest, NextResponse } from "next/server";
import type { Incident } from "./types";
import { parseIncident } from "./incident-store";

const COOKIE_PREFIX = "aira-incident-";
const COOKIE_MAX_AGE = 60 * 60 * 24;

function cookieName(id: string): string {
  return `${COOKIE_PREFIX}${id}`;
}

function encodeIncident(incident: Incident): string {
  return Buffer.from(JSON.stringify(incident), "utf8").toString("base64url");
}

export function readIncidentCookie(req: NextRequest, id: string): Incident | null {
  const raw = req.cookies.get(cookieName(id))?.value;
  if (!raw) return null;
  try {
    return parseIncident(JSON.parse(Buffer.from(raw, "base64url").toString("utf8")), id);
  } catch {
    return null;
  }
}

export function setIncidentCookie<T extends NextResponse>(res: T, incident: Incident): T {
  res.cookies.set({
    name: cookieName(incident.id),
    value: encodeIncident(incident),
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: COOKIE_MAX_AGE,
  });
  return res;
}
