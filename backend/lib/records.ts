import type { RetainRecord } from "./hindsight";
import type { AgentSuggestion, Incident } from "./types";
import { SEED_INCIDENTS, seedTimestamp } from "./seed-data";

/**
 * Record-level helpers: turn incidents into structured Hindsight content and
 * parse recalled facts back into fields.
 *
 * Every retained record uses `Field: value` lines so a fact can be re-parsed
 * even when Hindsight's metadata does not survive extraction — this keeps the
 * success-rate math working either way.
 */

/** Fields recovered from a structured record (metadata or text). */
export interface ParsedRecordFields {
  recordId?: string;
  service?: string;
  severity?: string;
  error?: string;
  errorSignature?: string;
  rootCause?: string;
  resolutionSteps?: string[];
  timeToResolve?: string;
  success?: boolean;
  occurredAt?: string;
  agentSuggestion?: string;
  resolutionApproach?: string;
}

function line(text: string, label: string): string | undefined {
  const m = text.match(new RegExp(`^${label}:\\s*(.+)$`, "mi"));
  return m?.[1]?.trim();
}

/** Parse `Field: value` lines back into structured fields. */
export function parseStructuredText(text: string): ParsedRecordFields {
  const fields: ParsedRecordFields = {};

  fields.recordId = line(text, "Record ID");
  fields.service = line(text, "Service");
  fields.severity = line(text, "Severity");
  fields.error = line(text, "Error");
  fields.errorSignature = line(text, "Error signature");
  fields.rootCause = line(text, "Root cause");
  fields.timeToResolve = line(text, "Time to resolve");
  fields.occurredAt = line(text, "Occurred at");
  fields.agentSuggestion = line(text, "Agent suggestion given");
  fields.resolutionApproach = line(text, "Resolution approach");

  const steps = line(text, "Resolution steps");
  if (steps) fields.resolutionSteps = steps.split(" | ").filter(Boolean);

  const outcome = line(text, "Outcome");
  if (outcome) fields.success = /^success/i.test(outcome);

  return fields;
}

/** Seed content builder (also used by scripts/seed-hindsight.ts for Hindsight). */
export function buildSeedRecords(): RetainRecord[] {
  return SEED_INCIDENTS.map((s) => {
    const timestamp = seedTimestamp(s.daysAgo);
    const content = [
      "Past production incident resolved by the SRE team.",
      `Record ID: ${s.id}`,
      `Service: ${s.service}`,
      `Severity: ${s.severity}`,
      `Error: ${s.error}`,
      `Error signature: ${s.errorSignature}`,
      `Root cause: ${s.rootCause}`,
      `Resolution approach: ${s.resolutionApproach}`,
      `Resolution steps: ${s.resolutionSteps.join(" | ")}`,
      `Time to resolve: ${s.timeToResolve}`,
      `Outcome: ${s.success ? "success" : "failure"} — resolution ${s.success ? "worked" : "did not hold"}`,
      `Occurred at: ${timestamp}`,
    ].join("\n");

    return {
      recordId: s.id,
      content,
      context: `incident-record:${s.id}`,
      metadata: {
        recordId: s.id,
        source: "seed",
        service: s.service,
        severity: s.severity,
        error: s.error,
        errorSignature: s.errorSignature,
        rootCause: s.rootCause,
        resolutionApproach: s.resolutionApproach,
        resolutionSteps: s.resolutionSteps.join(" | "),
        timeToResolve: s.timeToResolve,
        success: String(s.success),
        occurredAt: timestamp,
      },
      timestamp,
    };
  });
}

export interface ExperienceInput {
  incident: Incident;
  success: boolean;
  rootCause?: string;
  resolutionSteps?: string[];
  timeToResolve?: string;
  suggestion?: AgentSuggestion;
}

/**
 * Build the record retained after user feedback — the learning event.
 * Contains the incident, what the agent suggested, the outcome and the
 * resolution, so future recalls can quote proven specifics.
 */
export function buildExperienceRecord(input: ExperienceInput): RetainRecord {
  const { incident, success } = input;
  const recordId = `live-${incident.id}`;
  const rootCause = input.rootCause?.trim() || incident.rootCause || "not recorded";
  const steps =
    input.resolutionSteps && input.resolutionSteps.length > 0
      ? input.resolutionSteps
      : incident.resolutionSteps ??
        (success ? input.suggestion?.steps ?? [] : []);
  const timeToResolve = input.timeToResolve?.trim() || incident.timeToResolve || "unknown";
  const occurredAt = incident.timestamp;
  const signature = incident.errorSignature ?? "unspecified-error";
  // Group the live record under the SAME approach as the fix the agent
  // suggested (so that fix's approach aggregate picks up this outcome).
  const approach = incident.chosenApproach?.trim() || signature;

  const suggestionText = input.suggestion?.steps?.length
    ? input.suggestion.steps.join(" | ")
    : incident.agentSuggestion ?? "none recorded";

  const content = [
    "Production incident experience retained by the Adaptive Incident Response Agent.",
    `Record ID: ${recordId}`,
    `Service: ${incident.service}`,
    `Severity: ${incident.severity}`,
    `Error: ${incident.error}`,
    `Error signature: ${signature}`,
    `Agent suggestion given: ${suggestionText}`,
    `Root cause: ${rootCause}`,
    `Resolution approach: ${approach}`,
    `Resolution steps: ${steps.join(" | ") || "none"}`,
    `Time to resolve: ${timeToResolve}`,
    `Outcome: ${success ? "success" : "failure"} — ${success ? "this fix resolved the incident" : "this fix did not resolve the incident"}`,
    `Occurred at: ${occurredAt}`,
  ].join("\n");

  return {
    recordId,
    content,
    context: `incident-record:${recordId}`,
    metadata: {
      recordId,
      source: "live",
      incidentId: incident.id,
      service: incident.service,
      severity: incident.severity,
      error: incident.error,
      errorSignature: signature,
      rootCause,
      resolutionApproach: approach,
      resolutionSteps: steps.join(" | "),
      timeToResolve,
      success: String(success),
      occurredAt,
      agentSuggestion: suggestionText,
    },
    timestamp: new Date().toISOString(),
  };
}
