"use client";

import { Brain, CircleCheck, CircleSlash, CircleAlert, CircleX } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { EmptyState } from "@/components/EmptyState";
import { cn } from "@/lib/utils";
import type { RankedCandidate } from "@backend/types";

function fmtDate(iso?: string): string {
  if (!iso) return "unknown date";
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "unknown date" : d.toISOString().slice(0, 10);
}

/**
 * Ranked past incidents recalled from memory — with the full score breakdown,
 * so judges can see exactly why one candidate was chosen over another.
 */
export function PastIncidents({
  candidates,
  memoryDisabled = false,
}: {
  candidates: RankedCandidate[];
  memoryDisabled?: boolean;
}) {
  if (memoryDisabled) {
    return (
      <EmptyState
        icon={CircleSlash}
        title="Memory skipped"
        description="With memory off, recall() never runs and no past incidents are retrieved — the model answers from general knowledge only."
      />
    );
  }

  if (candidates.length === 0) {
    return (
      <EmptyState
        icon={Brain}
        title="No similar past incidents"
        description="Recall returned nothing strongly matching this error signature yet. Submit feedback after resolving it and the next similar report will draw from it."
      />
    );
  }

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-xs font-medium text-muted-foreground">
          Similar past incidents — ranked in application code
        </p>
        <p className="font-mono text-[10px] text-muted-foreground/80">
          score = 0.55·similarity + 0.30·success (own outcome + approach) + 0.15·recency
        </p>
      </div>

      <div className="divide-y divide-border/60 overflow-hidden rounded-lg border border-border/70">
        {candidates.map((c) => {
          const e = c.experience;
          const isTop = c.rank === 1;
          return (
            <div
              key={e.recordId}
              className={cn(
                "flex flex-col gap-3 p-3 sm:flex-row sm:items-start sm:justify-between sm:gap-4",
                isTop && "bg-emerald-500/[0.05]",
              )}
            >
              <div className="min-w-0 flex-1 space-y-1.5">
                <div className="flex flex-wrap items-center gap-2">
                  <span
                    className={cn(
                      "flex size-5 items-center justify-center rounded-md text-[10px] font-bold tabular-nums",
                      isTop
                        ? "bg-emerald-500/20 text-emerald-300"
                        : "bg-muted text-muted-foreground",
                    )}
                  >
                    {c.rank}
                  </span>
                  <span className="text-sm font-medium">{e.service}</span>
                  <span className="text-xs text-muted-foreground">
                    {fmtDate(e.occurredAt)} · {Math.round(c.ageDays)}d ago
                  </span>
                  {e.success === true ? (
                    <Badge className="gap-1 bg-emerald-500/15 text-emerald-300">
                      <CircleCheck className="size-3" /> fixed
                    </Badge>
                  ) : e.success === false ? (
                    <Badge className="gap-1 bg-red-500/15 text-red-300">
                      <CircleX className="size-3" /> failed
                    </Badge>
                  ) : (
                    <Badge variant="outline" className="text-muted-foreground">
                      unknown outcome
                    </Badge>
                  )}
                  {isTop ? (
                    <Badge className="bg-emerald-500/20 text-emerald-200 ring-1 ring-emerald-500/40">
                      chosen
                    </Badge>
                  ) : null}
                </div>

                <p className="line-clamp-2 text-xs leading-relaxed text-muted-foreground">
                  {e.rootCause ?? "Root cause not recorded."}
                </p>

                <p className="font-mono text-[10px] text-muted-foreground/75">
                  sim {c.semanticScore.toFixed(2)} · success {c.successRate.toFixed(2)} (own
                  {e.success === true ? " fixed" : e.success === false ? " failed" : "?"} ·
                  approach {c.successes}/{c.attempts}) · recency {c.recencyScore.toFixed(2)} ·
                  TTR {e.timeToResolve ?? "n/a"}
                </p>
              </div>

              <div className="flex items-center gap-3 sm:flex-col sm:items-end sm:gap-1.5">
                <span className="text-lg leading-none font-semibold tabular-nums">
                  {c.score.toFixed(2)}
                </span>
                <div className="h-1.5 w-28 overflow-hidden rounded-full bg-muted">
                  <div
                    className={cn(
                      "h-full rounded-full",
                      isTop ? "bg-emerald-400" : "bg-sky-400/70",
                    )}
                    style={{ width: `${Math.round(c.score * 100)}%` }}
                  />
                </div>
              </div>
            </div>
          );
        })}
      </div>

      <p className="flex items-center gap-1.5 pt-1 text-[11px] text-muted-foreground">
        <CircleAlert className="size-3" />
        Failures stay in memory on purpose — they lower a fix&apos;s success rate instead of
        being discarded.
      </p>
    </div>
  );
}
