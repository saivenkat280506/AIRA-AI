import { env } from "./env";
import { getMemoryBackend } from "./memory";
import type { BackendStatus } from "./types";

/**
 * Build the backend status block returned by every API response so the UI can
 * always show *how* an answer was produced (live vs fallback) — honesty during
 * judging, and a place to surface calm degradation notices.
 */
export function buildBackendStatus(
  opts: {
    llmProvider?: "groq" | "fallback";
    degraded?: boolean;
    note?: string;
  } = {},
): BackendStatus {
  const memory = getMemoryBackend();
  const llmProvider =
    opts.llmProvider ?? (env.groqConfigured ? "groq" : "fallback");

  return {
    memory: memory.name,
    llm: llmProvider,
    memoryDetail:
      memory.name === "hindsight"
        ? memory.detail
        : env.hindsightConfigured
          ? `${memory.detail} (forced via MEMORY_BACKEND)`
          : `${memory.detail} · Hindsight key not configured`,
    llmDetail:
      llmProvider === "groq"
        ? `Groq · ${env.groqModel}`
        : env.groqConfigured
          ? "Local fallback generator"
          : "Local fallback generator (no GROQ_API_KEY)",
    degraded: opts.degraded ?? false,
    ...(opts.note ? { note: opts.note } : {}),
  };
}
