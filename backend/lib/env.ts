/**
 * Central, lazily-read environment configuration.
 *
 * Backends are resolved at call time (not import time) so the app can start
 * cleanly with zero keys and fall back to the local demo backends.
 *
 *   GROQ_API_KEY          -> Groq LLM
 *   GROQ_MODEL            -> defaults to llama-3.3-70b-versatile
 *   HINDSIGHT_API_KEY     -> Hindsight Cloud
 *   HINDSIGHT_API_URL     -> defaults to https://api.hindsight.vectorize.io
 *   HINDSIGHT_BANK_ID     -> defaults to sre-incidents
 *   MEMORY_BACKEND        -> auto | hindsight | fallback   (default: auto)
 *   LLM_BACKEND           -> auto | groq | fallback        (default: auto)
 *   DEMO_FALLBACK         -> "1" forces both local fallbacks (rehearsed-demo safety net)
 */

const DEFAULT_HINDSIGHT_URL = "https://api.hindsight.vectorize.io";
const DEFAULT_BANK_ID = "sre-incidents";
const DEFAULT_GROQ_MODEL = "llama-3.3-70b-versatile";

function read(name: string): string {
  return (process.env[name] ?? "").trim();
}

function flag(name: string): boolean {
  const v = read(name).toLowerCase();
  return v === "1" || v === "true" || v === "yes" || v === "on";
}

export type BackendPreference = "auto" | "hindsight" | "fallback" | "groq";

export const env = {
  get groqApiKey(): string {
    return read("GROQ_API_KEY");
  },
  get groqModel(): string {
    return read("GROQ_MODEL") || DEFAULT_GROQ_MODEL;
  },
  get hindsightApiKey(): string {
    return read("HINDSIGHT_API_KEY");
  },
  get hindsightBaseUrl(): string {
    return read("HINDSIGHT_API_URL") || DEFAULT_HINDSIGHT_URL;
  },
  get bankId(): string {
    return read("HINDSIGHT_BANK_ID") || DEFAULT_BANK_ID;
  },
  /** Force both live integrations off (used for rehearsals / offline judging). */
  get demoFallback(): boolean {
    return flag("DEMO_FALLBACK");
  },
  get memoryPreference(): BackendPreference {
    const v = read("MEMORY_BACKEND").toLowerCase() as BackendPreference;
    return v === "hindsight" || v === "fallback" ? v : "auto";
  },
  get llmPreference(): "auto" | "groq" | "fallback" {
    const v = read("LLM_BACKEND").toLowerCase();
    return v === "groq" || v === "fallback" ? v : "auto";
  },

  /** True when Hindsight Cloud is usable (key present, not overridden). */
  get hindsightConfigured(): boolean {
    return !this.demoFallback && this.memoryPreference !== "fallback" && this.hindsightApiKey !== "";
  },
  /** True when Groq is usable (key present, not overridden). */
  get groqConfigured(): boolean {
    return !this.demoFallback && this.llmPreference !== "fallback" && this.groqApiKey !== "";
  },
};
