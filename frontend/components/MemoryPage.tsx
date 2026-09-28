"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import {
  Brain,
  CircleCheck,
  CircleX,
  Database,
  LoaderCircle,
  Sparkles,
  TrendingUp,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Card, CardAction, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { EmptyState } from "@/components/EmptyState";
import { Skeleton } from "@/components/ui/skeleton";
import { SeverityBadge } from "@/components/SeverityBadge";
import { cn } from "@/lib/utils";
import type { Incident, MemoryExperience, MemoryOverview } from "@backend/types";

/** Entries retained within this window wear the "Just learned" badge. */
const JUST_LEARNED_WINDOW_MS = 10 * 60 * 1000;

function withinWindow(iso: string | undefined): boolean {
  if (!iso) return false;
  const t = Date.parse(iso);
  return !Number.isNaN(t) && Date.now() - t < JUST_LEARNED_WINDOW_MS;
}

function isJustLearned(exp: MemoryExperience): boolean {
  return (
    withinWindow(exp.retainedAt) ||
    (exp.source === "live" && withinWindow(exp.occurredAt))
  );
}

function JustLearnedBadge() {
  return (
    <Badge className="gap-1 bg-emerald-500/20 text-emerald-200 ring-1 ring-emerald-500/40">
      <Sparkles className="size-3" /> Just learned
    </Badge>
  );
}

/**
 * Memory view: proof that memory exists and is growing.
 * Experiences are read back out of the backend with a live recall() call.
 */
export function MemoryPage() {
  const [memory, setMemory] = useState<MemoryOverview | null>(null);
  const [incidents, setIncidents] = useState<Incident[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    Promise.all([
      fetch("/api/memory").then((r) => (r.ok ? r.json() : Promise.reject(new Error("memory fetch failed")))),
      fetch("/api/incident?limit=50").then((r) => r.json()),
    ])
      .then(([mem, inc]) => {
        if (cancelled) return;
        setMemory(mem as MemoryOverview);
        setIncidents((inc?.incidents ?? []) as Incident[]);
      })
      .catch((err) => {
        if (!cancelled) setError(err instanceof Error ? err.message : "Failed to load memory");
      });
    return () => {
      cancelled = true;
    };
  }, []);

  if (error) {
    return (
      <EmptyState
        icon={CircleX}
        title="Memory unavailable"
        description={error}
        action={
          <Link href="/" className="text-xs font-medium text-emerald-300 underline-offset-4 hover:underline">
            ← Back to dashboard
          </Link>
        }
      />
    );
  }

  if (!memory) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-8 w-48" />
        <div className="grid gap-3 sm:grid-cols-3">
          {[1, 2, 3].map((i) => (
            <Skeleton key={i} className="h-24 w-full" />
          ))}
        </div>
        <Skeleton className="h-64 w-full" />
      </div>
    );
  }

  const stats = [
    {
      icon: Database,
      label: "Memory units",
      value: memory.retainedTotal ?? "—",
      hint: `${memory.experiences.length} incident records · ${memory.backends.memory === "hindsight" ? "Hindsight" : "local"}`,
    },
    {
      icon: Brain,
      label: "Experiences with feedback",
      value: memory.learnedCount,
      hint: "rated in this workspace",
    },
    {
      icon: TrendingUp,
      label: "Resolved successfully",
      value:
        memory.learnedSuccessRate != null
          ? `${Math.round(memory.learnedSuccessRate * 100)}%`
          : "—",
      hint:
        memory.learnedSuccessRate != null
          ? `${Math.round(memory.learnedSuccessRate * memory.learnedCount)}/${memory.learnedCount} feedback events resolved`
          : "waiting for first feedback",
    },
  ];

  return (
    <div className="space-y-8">
      <div className="flex flex-wrap items-start justify-between gap-3 pt-2">
        <div className="space-y-1.5">
          <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">Memory</h1>
          <p className="max-w-2xl text-sm text-muted-foreground">
            Everything the agent has retained from past incidents — every feedback event
            (success or failure) grows this bank and changes future rankings.
          </p>
        </div>
        <Badge
          className={cn(
            memory.backends.memory === "hindsight"
              ? "bg-emerald-500/15 text-emerald-300"
              : "bg-sky-500/15 text-sky-300",
          )}
        >
          <Sparkles className="size-3" />
          {memory.backends.memoryDetail}
        </Badge>
      </div>

      {/* Stats */}
      <div className="grid gap-3 sm:grid-cols-3">
        {stats.map(({ icon: Icon, label, value, hint }) => (
          <Card key={label} className="border-border/70">
            <CardContent className="flex items-center gap-3 py-4">
              <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-muted text-muted-foreground">
                <Icon className="size-4" />
              </span>
              <div className="min-w-0">
                <p className="text-xs text-muted-foreground">{label}</p>
                <p className="text-xl font-semibold tabular-nums">{value}</p>
                <p className="truncate text-[10px] text-muted-foreground/70">{hint}</p>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* What the agent remembers (live recall) */}
      <Card className="border-border/70">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <Brain className="size-4 text-emerald-400" />
            What the agent remembers
          </CardTitle>
          <CardAction>
            <span className="text-[11px] text-muted-foreground">
              read back with recall()
            </span>
          </CardAction>
        </CardHeader>
        <CardContent>
          {memory.experiences.length === 0 ? (
            <EmptyState
              icon={Database}
              title="Memory bank is empty"
              description={
                memory.backends.memory === "hindsight"
                  ? "Run `npm run seed` to load the 15-incident demo corpus into Hindsight, then report an incident."
                  : "Report an incident and submit feedback to store your first experience."
              }
            />
          ) : (
            <div className="divide-y divide-border/60">
              {memory.experiences.map((exp) => {
                const fresh = isJustLearned(exp);
                return (
                  <div
                    key={exp.recordId}
                    className={cn(
                      "flex flex-col gap-1.5 py-3",
                      fresh && "bg-emerald-500/[0.04]",
                    )}
                  >
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-mono text-[10px] text-muted-foreground">
                        {exp.recordId}
                      </span>
                      <span className="text-sm font-medium">{exp.service ?? "unknown service"}</span>
                      {exp.success === true ? (
                        <Badge className="gap-1 bg-emerald-500/15 text-emerald-300">
                          <CircleCheck className="size-3" /> success
                        </Badge>
                      ) : exp.success === false ? (
                        <Badge className="gap-1 bg-red-500/15 text-red-300">
                          <CircleX className="size-3" /> failure
                        </Badge>
                      ) : null}
                      {fresh ? <JustLearnedBadge /> : null}
                      {exp.errorSignature ? (
                        <span className="font-mono text-[10px] text-muted-foreground/70">
                          {exp.errorSignature}
                        </span>
                      ) : null}
                      <span className="ml-auto text-[10px] text-muted-foreground">
                        {exp.occurredAt ? new Date(exp.occurredAt).toLocaleDateString() : ""}
                      </span>
                    </div>
                    <p className="line-clamp-2 text-xs leading-relaxed text-muted-foreground">
                      {exp.rootCause ?? exp.error ?? exp.text.slice(0, 180)}
                    </p>
                    {exp.resolutionSteps?.length ? (
                      <p className="line-clamp-1 font-mono text-[10px] text-muted-foreground/70">
                        fix: {exp.resolutionSteps.join(" → ")}
                      </p>
                    ) : null}
                  </div>
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Incident history */}
      <Card className="border-border/70">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <TrendingUp className="size-4 text-muted-foreground" />
            Incident history
          </CardTitle>
        </CardHeader>
        <CardContent>
          {incidents === null ? (
            <div className="space-y-2">
              {[1, 2, 3].map((i) => (
                <Skeleton key={i} className="h-12 w-full" />
              ))}
            </div>
          ) : incidents.length === 0 ? (
            <EmptyState
              icon={LoaderCircle}
              title="No incidents reported yet"
              description="Report your first incident from the dashboard — after feedback it will appear here and in the memory bank above."
            />
          ) : (
            <div className="divide-y divide-border/60">
              {[...incidents]
                .sort(
                  (a, b) =>
                    Date.parse(b.feedbackAt ?? b.timestamp) -
                    Date.parse(a.feedbackAt ?? a.timestamp),
                )
                .map((inc) => {
                  const fresh = withinWindow(inc.feedbackAt);
                  return (
                    <Link
                      key={inc.id}
                      href={`/incident/${inc.id}`}
                      className={cn(
                        "flex items-center gap-3 py-2.5 transition-opacity hover:opacity-80",
                        fresh && "bg-emerald-500/[0.04]",
                      )}
                    >
                      <SeverityBadge severity={inc.severity} />
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2">
                          <span className="text-sm font-medium">{inc.service}</span>
                          <span className="text-[10px] text-muted-foreground">
                            {new Date(inc.timestamp).toLocaleString()}
                          </span>
                          {fresh ? <JustLearnedBadge /> : null}
                        </div>
                        <p className="truncate font-mono text-[11px] text-muted-foreground">
                          {inc.error}
                        </p>
                      </div>
                      {inc.matchScore != null ? (
                        <span className="shrink-0 font-mono text-[10px] text-muted-foreground">
                          match {inc.matchScore.toFixed(2)}
                        </span>
                      ) : null}
                      {inc.feedbackSubmitted ? (
                        inc.success ? (
                          <Badge className="shrink-0 gap-1 bg-emerald-500/15 text-emerald-300">
                            <CircleCheck className="size-3" /> fixed
                          </Badge>
                        ) : (
                          <Badge className="shrink-0 gap-1 bg-red-500/15 text-red-300">
                            <CircleX className="size-3" /> failed
                          </Badge>
                        )
                      ) : (
                        <Badge variant="outline" className="shrink-0 text-[10px] text-muted-foreground">
                          open
                        </Badge>
                      )}
                    </Link>
                  );
                })}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
