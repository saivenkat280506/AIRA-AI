import { promises as fs } from "node:fs";
import path from "node:path";
import { buildSeedRecords } from "./records";
import type { RetainRecord } from "./hindsight";
import type { RecalledFact } from "./types";

/**
 * Local fallback memory backend.
 *
 * Implements the same retain()/recall() contract as the Hindsight backend so the
 * demo never hangs on a blank screen when Hindsight is slow, rate-limited or not
 * configured (reliability requirement). It runs the exact same seed corpus, so
 * the with/without-memory comparison behaves identically offline.
 *
 * Storage: .data/fallback-memory.json (auto-seeded with lib/seed-data.ts).
 */

const DATA_DIR = path.join(process.cwd(), ".data");
const STORE_PATH = path.join(DATA_DIR, "fallback-memory.json");

interface StoredRecord {
  recordId: string;
  content: string;
  context?: string;
  metadata: Record<string, string>;
  timestamp: string;
}

interface FallbackStore {
  seeded: boolean;
  records: StoredRecord[];
}

const STOPWORDS = new Set([
  "a", "an", "the", "to", "of", "in", "on", "for", "and", "or", "is", "are",
  "at", "by", "with", "from", "after", "during", "when", "that", "this",
  "it", "as", "be", "been", "was", "were", "has", "have", "had", "not", "no",
  "we", "our", "their", "its", "into", "than", "then", "but", "if",
]);

function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .split(/\s+/)
    .filter((t) => t.length > 1 && !STOPWORDS.has(t));
}

/** Serialize writes so concurrent API calls cannot clobber each other. */
let writeQueue: Promise<unknown> = Promise.resolve();
function enqueue<T>(fn: () => Promise<T>): Promise<T> {
  const next = writeQueue.then(fn, fn);
  writeQueue = next.catch(() => undefined);
  return next;
}

async function loadStore(): Promise<FallbackStore> {
  try {
    const raw = await fs.readFile(STORE_PATH, "utf8");
    const parsed = JSON.parse(raw) as FallbackStore;
    if (Array.isArray(parsed.records)) return parsed;
  } catch {
    /* first run or corrupt file — fall through to seed */
  }
  return seedStore();
}

async function seedStore(): Promise<FallbackStore> {
  const store: FallbackStore = { seeded: true, records: buildSeedRecords() };
  await enqueue(async () => {
    await fs.mkdir(DATA_DIR, { recursive: true });
    await fs.writeFile(STORE_PATH, JSON.stringify(store, null, 2), "utf8");
  });
  return store;
}

/** Append records (used by feedback + the seed script). */
export async function fallbackRetain(records: RetainRecord[]): Promise<void> {
  await enqueue(async () => {
    const store = await loadStore();
    for (const r of records) {
      const existing = store.records.findIndex((x) => x.recordId === r.recordId);
      if (existing >= 0) store.records[existing] = r;
      else store.records.push(r);
    }
    await fs.mkdir(DATA_DIR, { recursive: true });
    await fs.writeFile(STORE_PATH, JSON.stringify(store, null, 2), "utf8");
  });
}

/**
 * Recall: token-overlap similarity in 0..1, mirroring Hindsight's semantic arm.
 * Only records with meaningful overlap are returned (mirrors a relevance floor).
 */
export async function fallbackRecall(
  query: string,
  options: { maxTokens?: number; limit?: number } = {},
): Promise<RecalledFact[]> {
  const store = await loadStore();
  const qTokens = tokenize(query);
  const qSet = new Set(qTokens);

  const scored = store.records.map((record) => {
    const dTokens = tokenize(record.content);
    const dSet = new Set(dTokens);
    let matched = 0;
    for (const t of qSet) if (dSet.has(t)) matched += 1;
    const similarity = qTokens.length === 0 ? 0 : matched / qTokens.length;
    return { record, similarity };
  });

  return scored
    .filter((s) => s.similarity >= 0.25)
    .sort((a, b) => b.similarity - a.similarity)
    .slice(0, options.limit ?? 8)
    .map(({ record, similarity }) => ({
      factId: `${record.recordId}:fact-0`,
      text: record.content,
      similarity,
      metadata: record.metadata,
      context: record.context,
      mentionedAt: record.timestamp,
    }));
}

/** Number of records currently stored (for memory-view stats). */
export async function fallbackCount(): Promise<number> {
  try {
    const store = await loadStore();
    return store.records.length;
  } catch {
    return 0;
  }
}

export async function fallbackIsSeeded(): Promise<boolean> {
  try {
    const store = await loadStore();
    return store.seeded;
  } catch {
    return false;
  }
}

/** Reset the local store (used by the seed script with --force). */
export async function fallbackReset(): Promise<void> {
  await enqueue(async () => {
    try {
      await fs.unlink(STORE_PATH);
    } catch {
      /* already gone */
    }
  });
}
