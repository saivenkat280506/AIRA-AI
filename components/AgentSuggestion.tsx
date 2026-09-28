"use client";

import { AlertTriangle, Ban, Brain, LoaderCircle, RefreshCw, Sparkles } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardAction, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { PastIncidents } from "@/components/PastIncidents";
import { cn } from "@/lib/utils";
import type { SuggestResponse } from "@/lib/types";

interface AgentSuggestionProps {
  loading: boolean;
  error: string | null;
  result: SuggestResponse | null;
  onRetry: () => void;
  /** Which side of the comparison this card renders (drives title + framing). */
  mode: "with" | "without";
}

/**
 * One side of the with/without-memory comparison: confidence, steps, reasoning
 * and the recalled candidates. Feedback controls live outside this card so the
 * page renders them exactly once below the split view.
 */
export function AgentSuggestion({
  loading,
  error,
  result,
  onRetry,
  mode,
}: AgentSuggestionProps) {
  const withMemory = mode === "with";
  const TitleIcon = withMemory ? Brain : Ban;

  const title = withMemory ? "With memory" : "Without memory";
  const subtitle = loading
    ? withMemory
      ? "Recalling from Hindsight, ranking in app code, phrasing with Groq…"
      : "Answering with recall skipped (identical model, identical incident)…"
    : result
      ? withMemory
        ? `recall + ranking + phrasing finished in ${(result.timings.totalMs / 1000).toFixed(1)}s`
        : "no recall, no candidates, no citations — general knowledge only"
      : "";

  return (
    <Card
      data-testid={`suggestion-${mode}`}
      className={cn("border-border/70", withMemory && "border-emerald-500/25")}
    >
      <CardHeader>
        <div className="space-y-1.5">
          <CardTitle
            className={cn(
              "flex items-center gap-2 text-base",
              withMemory ? "text-emerald-200" : "text-foreground",
            )}
          >
            <TitleIcon className={cn("size-4", withMemory ? "text-emerald-400" : "text-muted-foreground")} />
            {title}
          </CardTitle>
          <p className="text-xs text-muted-foreground">{subtitle}</p>
        </div>
        {result ? (
          <CardAction className="flex flex-wrap items-center justify-end gap-1.5">
            <Badge
              className={cn(
                result.usedMemory
                  ? "bg-emerald-500/15 text-emerald-300"
                  : "bg-muted text-muted-foreground",
              )}
            >
              <Sparkles className="size-3" />
              {result.usedMemory
                ? `memory on · ${result.candidates.length} recalled`
                : "memory off"}
            </Badge>
            <Badge variant="outline" className="text-[10px] text-muted-foreground">
              {result.backends.llmDetail}
            </Badge>
          </CardAction>
        ) : null}
      </CardHeader>

      <CardContent className="space-y-6">
        {result?.backends.degraded ? (
          <div className="flex items-start gap-2 rounded-md border border-amber-500/30 bg-amber-500/[0.07] px-3 py-2 text-xs text-amber-200/90">
            <AlertTriangle className="mt-0.5 size-3.5 shrink-0" />
            <span>{result.backends.note ?? "Running in degraded mode."}</span>
          </div>
        ) : null}

        {loading ? <SuggestionSkeleton mode={mode} /> : null}

        {!loading && error ? (
          <div className="space-y-3 rounded-md border border-red-500/30 bg-red-500/[0.06] p-4">
            <p className="text-sm font-medium text-red-300">
              The {withMemory ? "with-memory" : "without-memory"} answer failed
            </p>
            <p className="text-xs text-muted-foreground">{error}</p>
            <Button variant="outline" size="sm" onClick={onRetry}>
              <RefreshCw className="size-3.5" />
              Try again
            </Button>
          </div>
        ) : null}

        {!loading && !error && result ? (
          <>
            <Confidence confidence={result.suggestion.confidence} usedMemory={result.usedMemory} />

            <div className="space-y-2">
              <p className="text-xs font-medium text-muted-foreground">
                Suggested resolution steps
              </p>
              <ol className="space-y-2">
                {result.suggestion.steps.map((step, i) => (
                  <li key={i} className="flex gap-3 text-sm leading-relaxed">
                    <span className="mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-md bg-muted text-[10px] font-semibold text-muted-foreground">
                      {i + 1}
                    </span>
                    <span>{step}</span>
                  </li>
                ))}
              </ol>
            </div>

            <div className="space-y-2">
              <p className="text-xs font-medium text-muted-foreground">
                Confidence &amp; reasoning
              </p>
              <blockquote className="border-l-2 border-emerald-500/50 bg-muted/30 px-3 py-2.5 text-sm leading-relaxed text-foreground/90">
                {result.suggestion.reasoning}
              </blockquote>
            </div>

            <PastIncidents
              candidates={result.candidates}
              memoryDisabled={!result.usedMemory}
            />
          </>
        ) : null}
      </CardContent>
    </Card>
  );
}

function Confidence({
  confidence,
  usedMemory,
}: {
  confidence: number;
  usedMemory: boolean;
}) {
  const pct = Math.round(confidence * 100);
  const tone = !usedMemory
    ? "bg-muted-foreground/50"
    : pct >= 70
      ? "bg-emerald-400"
      : pct >= 40
        ? "bg-amber-400"
        : "bg-red-400";

  return (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between text-xs">
        <span className="font-medium text-muted-foreground">Confidence</span>
        <span className="tabular-nums text-foreground">{pct}%</span>
      </div>
      <div className="h-1.5 w-full overflow-hidden rounded-full bg-muted">
        <div className={cn("h-full rounded-full transition-all", tone)} style={{ width: `${pct}%` }} />
      </div>
      {!usedMemory ? (
        <p className="text-[11px] text-muted-foreground">
          Illustrative baseline (not measured) — with memory off there is no team
          history to ground the answer.
        </p>
      ) : null}
    </div>
  );
}

function SuggestionSkeleton({ mode }: { mode: "with" | "without" }) {
  return (
    <div className="space-y-4">
      <div className="space-y-2">
        <Skeleton className="h-3 w-32" />
        <Skeleton className="h-2 w-full" />
      </div>
      <div className="space-y-2.5">
        <Skeleton className="h-4 w-48" />
        {[1, 2, 3, 4].map((i) => (
          <div key={i} className="flex gap-3">
            <Skeleton className="size-5 shrink-0 rounded-md" />
            <Skeleton className="h-4 flex-1" />
          </div>
        ))}
      </div>
      <div className="space-y-2">
        <Skeleton className="h-3 w-40" />
        <Skeleton className="h-20 w-full rounded-md" />
      </div>
      <div className="flex items-center gap-2 text-xs text-muted-foreground">
        <LoaderCircle className="size-3.5 animate-spin" />
        {mode === "with"
          ? "Recalling, ranking and phrasing the suggestion…"
          : "Phrasing a no-memory answer…"}
      </div>
    </div>
  );
}
