import { promises as fs } from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { computeErrorSignature } from "@/lib/memory";
import type { Incident, Severity } from "@/lib/types";

/**
 * Local transactional log of incidents reported to the app.
 *
 * NOTE: this is application state (what was reported, what the user rated it),
 * not the agent's memory — all learning flows through Hindsight retain()/recall().
 * Keeping this tiny JSON log lets the dashboard, detail page and history view
 * stay fast and reliable regardless of backend health.
 */

const DATA_DIR = path.join(process.cwd(), ".data");
const STORE_PATH = path.join(DATA_DIR, "incidents.json");

interface Store {
  incidents: Incident[];
}

let writeQueue: Promise<unknown> = Promise.resolve();
function enqueue<T>(fn: () => Promise<T>): Promise<T> {
  const next = writeQueue.then(fn, fn);
  writeQueue = next.catch(() => undefined);
  return next;
}

async function load(): Promise<Store> {
  try {
    const raw = await fs.readFile(STORE_PATH, "utf8");
    const parsed = JSON.parse(raw) as Store;
    if (Array.isArray(parsed.incidents)) return parsed;
  } catch {
    /* first run */
  }
  return { incidents: [] };
}

async function save(store: Store): Promise<void> {
  await fs.mkdir(DATA_DIR, { recursive: true });
  await fs.writeFile(STORE_PATH, JSON.stringify(store, null, 2), "utf8");
}

export interface CreateIncidentInput {
  service: string;
  error: string;
  severity: Severity;
  timestamp?: string;
}

export async function createIncident(
  input: CreateIncidentInput,
): Promise<Incident> {
  const incident: Incident = {
    id: randomUUID(),
    timestamp: input.timestamp || new Date().toISOString(),
    service: input.service.trim(),
    error: input.error.trim(),
    severity: input.severity,
    errorSignature: computeErrorSignature(input.service, input.error),
  };

  await enqueue(async () => {
    const store = await load();
    store.incidents.unshift(incident);
    // Keep the log bounded — memory lives in Hindsight, not here.
    if (store.incidents.length > 200) store.incidents.length = 200;
    await save(store);
  });

  return incident;
}

export async function getIncident(id: string): Promise<Incident | null> {
  const store = await load();
  return store.incidents.find((i) => i.id === id) ?? null;
}

export async function listIncidents(limit = 25): Promise<Incident[]> {
  const store = await load();
  return store.incidents.slice(0, limit);
}

export async function updateIncident(
  id: string,
  patch: Partial<Incident>,
): Promise<Incident | null> {
  return enqueue(async () => {
    const store = await load();
    const idx = store.incidents.findIndex((i) => i.id === id);
    if (idx < 0) return null;
    store.incidents[idx] = { ...store.incidents[idx], ...patch, id };
    await save(store);
    return store.incidents[idx];
  });
}

export interface IncidentStats {
  total: number;
  learned: number;
  /** retain() calls whose feedback landed today (UTC day). */
  learnedToday: number;
  successes: number;
  /** success rate over incidents the user gave feedback on (null when none). */
  successRate: number | null;
}

function isToday(iso: string | undefined): boolean {
  if (!iso) return false;
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return false;
  const d = new Date(t);
  const now = new Date();
  return (
    d.getUTCFullYear() === now.getUTCFullYear() &&
    d.getUTCMonth() === now.getUTCMonth() &&
    d.getUTCDate() === now.getUTCDate()
  );
}

export async function getIncidentStats(): Promise<IncidentStats> {
  const store = await load();
  const learned = store.incidents.filter((i) => i.feedbackSubmitted === true);
  const successes = learned.filter((i) => i.success === true).length;
  const learnedToday = store.incidents.filter((i) => isToday(i.feedbackAt)).length;
  return {
    total: store.incidents.length,
    learned: learned.length,
    learnedToday,
    successes,
    successRate: learned.length > 0 ? successes / learned.length : null,
  };
}
