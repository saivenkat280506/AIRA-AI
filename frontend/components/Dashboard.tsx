"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import {
  Activity,
  CircleCheck,
  CircleSlash,
  Database,
  History,
  LoaderCircle,
  Sparkles,
  ThumbsUp,
} from "lucide-react";
import { CountUp } from "@/components/CountUp";
import { IncidentForm } from "@/components/IncidentForm";
import { EmptyState } from "@/components/EmptyState";
import { useLearnedToday } from "@/components/LearnedToday";
import { SeverityBadge } from "@/components/SeverityBadge";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import type { Incident, MemoryOverview } from "@backend/types";

/** Dashboard: report a new incident + see what the agent has learned so far. */
export function Dashboard() {
  const [incidents, setIncidents] = useState<Incident[] | null>(null);
  const [memory, setMemory] = useState<MemoryOverview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const { count: learnedToday } = useLearnedToday();

  useEffect(() => {
    let cancelled = false;
    Promise.all([
      fetch("/api/incident?limit=8").then((r) => r.json()),
      fetch("/api/memory").then((r) => (r.ok ? r.json() : null)),
    ])
      .then(([inc, mem]) => {
        if (cancelled) return;
        if (inc?.error) throw new Error(inc.error);
        setIncidents((inc?.incidents ?? []) as Incident[]);
        setMemory(mem as MemoryOverview | null);
      })
      .catch((err) => {
        if (!cancelled) setError(err instanceof Error ? err.message : "Failed to load");
      });
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <div className="space-y-8">
      {/* Hero */}
      <div className="space-y-2 pt-2">
        <h1 className="text-3xl font-semibold tracking-tight sm:text-4xl">
          Fix incidents with memory.
        </h1>
        <p className="max-w-2xl text-sm leading-relaxed text-muted-foreground">
          Report a production incident. AIRA recalls similar past incidents from Hindsight,
          ranks them by similarity, historical success rate and recency — then suggests the
          fix your team already proved. Feedback makes the next answer sharper.
        </p>
      </div>

      {/* Stats */}
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard
          icon={Database}
          label="Memory units"
          value={memory ? (memory.retainedTotal ?? "—") : null}
          hint={
            memory
              ? `${memory.experiences.length} incident records · ${memory.backends.memory === "hindsight" ? "Hindsight" : "local"}`
              : undefined
          }
        />
        <StatCard
          icon={Sparkles}
          label="Learned today"
          value={learnedToday === null ? null : <CountUp value={learnedToday} />}
          hint="retain() calls — ticks as you rate"
        />
        <StatCard
          icon={Activity}
          label="Incidents reported"
          value={memory ? memory.incidentCount : incidents ? incidents.length : null}
          hint="this workspace"
        />
        <StatCard
          icon={ThumbsUp}
          label="Feedback learned"
          value={memory ? `${memory.learnedCount}` : null}
          hint={
            memory?.learnedSuccessRate != null
              ? `${Math.round(memory.learnedSuccessRate * 100)}% resolved successfully`
              : "no feedback yet"
          }
        />
      </div>

      <div className="grid gap-6 lg:grid-cols-5">
        {/* Form */}
        <div className="lg:col-span-3">
          <IncidentForm />
        </div>

        {/* Recent incidents */}
        <div className="lg:col-span-2">
          <Card className="border-border/70">
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-base">
                <History className="size-4 text-muted-foreground" />
                Recent incidents
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-2">
              {error ? (
                <p className="text-xs text-red-400">{error}</p>
              ) : incidents === null ? (
                <div className="space-y-2">
                  {[1, 2, 3].map((i) => (
                    <Skeleton key={i} className="h-14 w-full" />
                  ))}
                </div>
              ) : incidents.length === 0 ? (
                <EmptyState
                  icon={Database}
                  title="No incidents yet"
                  description="Seed data is loaded and ready — click “Prefill demo” and report the Redis connection timeout to see ranked recall in action."
                  className="py-8"
                />
              ) : (
                <ul className="divide-y divide-border/60">
                  {incidents.map((inc) => (
                    <li key={inc.id}>
                      <Link
                        href={`/incident/${inc.id}`}
                        className="flex items-start gap-3 py-2.5 transition-opacity hover:opacity-80"
                      >
                        <SeverityBadge severity={inc.severity} className="mt-0.5" />
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center justify-between gap-2">
                            <span className="truncate text-sm font-medium">
                              {inc.service}
                            </span>
                            <span className="shrink-0 text-[10px] text-muted-foreground">
                              {new Date(inc.timestamp).toLocaleDateString()}
                            </span>
                          </div>
                          <p className="truncate font-mono text-[11px] text-muted-foreground">
                            {inc.error}
                          </p>
                        </div>
                        <StatusChip incident={inc} />
                      </Link>
                    </li>
                  ))}
                </ul>
              )}
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}

function StatusChip({ incident }: { incident: Incident }) {
  if (incident.feedbackSubmitted && incident.success) {
    return (
      <Badge className="shrink-0 gap-1 bg-emerald-500/15 text-emerald-300">
        <CircleCheck className="size-3" /> fixed
      </Badge>
    );
  }
  if (incident.feedbackSubmitted) {
    return (
      <Badge className="shrink-0 gap-1 bg-red-500/15 text-red-300">
        <CircleSlash className="size-3" /> no fix
      </Badge>
    );
  }
  return (
    <Badge variant="outline" className="shrink-0 text-[10px] text-muted-foreground">
      open
    </Badge>
  );
}

function StatCard({
  icon: Icon,
  label,
  value,
  hint,
}: {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  value: React.ReactNode;
  hint?: string;
}) {
  return (
    <Card className="border-border/70">
      <CardContent className="flex items-center gap-3 py-4">
        <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-muted text-muted-foreground">
          <Icon className="size-4" />
        </span>
        <div className="min-w-0">
          <p className="text-xs text-muted-foreground">{label}</p>
          <p className={cn("text-xl font-semibold tabular-nums", value === null && "text-muted-foreground/50")}>
            {value === null ? <LoaderCircle className="size-4 animate-spin" /> : value}
          </p>
          {hint ? (
            <p className="truncate text-[10px] text-muted-foreground/70">{hint}</p>
          ) : null}
        </div>
      </CardContent>
    </Card>
  );
}
