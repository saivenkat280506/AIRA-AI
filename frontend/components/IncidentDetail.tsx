"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { ArrowLeft, Clock, Fingerprint, LoaderCircle, Terminal } from "lucide-react";
import { AgentSuggestion } from "@/components/AgentSuggestion";
import { EmptyState } from "@/components/EmptyState";
import { FeedbackPanel } from "@/components/FeedbackPanel";
import { useLearnedToday } from "@/components/LearnedToday";
import { MemoryToggle } from "@/components/MemoryToggle";
import {
  RankingShiftPanel,
  computeRankingShift,
  type RankingShiftStatus,
} from "@/components/RankingShiftPanel";
import { SeverityBadge } from "@/components/SeverityBadge";
import { Skeleton } from "@/components/ui/skeleton";
import { toast } from "@/components/ui/use-toast";
import type {
  FeedbackResponse,
  Incident,
  RankedCandidate,
  RerankResponse,
  SuggestResponse,
} from "@backend/types";

/**
 * Incident detail: report header + the side-by-side with/without-memory
 * comparison (both fetched in parallel), then feedback and — after retain()
 * succeeds — the ranking-shift reveal.
 */
export function IncidentDetail({ id }: { id: string }) {
  const [incident, setIncident] = useState<Incident | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  // Side-by-side answers (parallel requests; the toggle only picks which one
  // narrow viewports show — both are already loaded).
  const [withRes, setWithRes] = useState<SuggestResponse | null>(null);
  const [withoutRes, setWithoutRes] = useState<SuggestResponse | null>(null);
  const [loadingWith, setLoadingWith] = useState(true);
  const [loadingWithout, setLoadingWithout] = useState(true);
  const [errWith, setErrWith] = useState<string | null>(null);
  const [errWithout, setErrWithout] = useState<string | null>(null);
  const [mobileMode, setMobileMode] = useState<"with" | "without">("with");

  // Pre-feedback ranked list, kept for the after-feedback diff (no second
  // Hindsight round-trip needed for the "before" side).
  const preFeedback = useRef<RankedCandidate[] | null>(null);

  const [feedback, setFeedback] = useState<FeedbackResponse | null>(null);
  const [feedbackSubmitting, setFeedbackSubmitting] = useState(false);
  const [shiftStatus, setShiftStatus] = useState<RankingShiftStatus | null>(null);

  const { bump } = useLearnedToday();
  const autoStarted = useRef(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`/api/incident?id=${encodeURIComponent(id)}`);
        const data = await res.json();
        if (!res.ok) throw new Error(data.error ?? "Incident not found");
        if (!cancelled) setIncident(data.incident as Incident);
      } catch (err) {
        if (!cancelled) {
          setLoadError(err instanceof Error ? err.message : "Failed to load incident");
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [id]);

  const runSuggest = useCallback(
    async (memory: boolean) => {
      if (memory) {
        setLoadingWith(true);
        setErrWith(null);
      } else {
        setLoadingWithout(true);
        setErrWithout(null);
      }
      try {
        const res = await fetch("/api/suggest", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ incidentId: id, useMemory: memory, incident }),
        });
        const data = (await res.json()) as SuggestResponse & { error?: string };
        if (!res.ok) throw new Error(data.error ?? "Suggestion failed");
        if (memory) {
          setWithRes(data);
          if (data.candidates && data.candidates.length > 0) {
            preFeedback.current = data.candidates;
          }
        } else {
          setWithoutRes(data);
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : "The agent could not answer.";
        if (memory) {
          setErrWith(msg);
          setWithRes(null);
        } else {
          setErrWithout(msg);
          setWithoutRes(null);
        }
      } finally {
        if (memory) setLoadingWith(false);
        else setLoadingWithout(false);
      }
    },
    [id, incident],
  );

  // Both answers start automatically, in parallel, once the incident loads.
  useEffect(() => {
    if (incident && !autoStarted.current) {
      autoStarted.current = true;
      void Promise.all([runSuggest(true), runSuggest(false)]);
    }
  }, [incident, runSuggest]);

  async function onFeedback(
    success: boolean,
    fields: { rootCause?: string; timeToResolve?: string },
  ) {
    if (feedbackSubmitting) return;
    setFeedbackSubmitting(true);
    try {
      const res = await fetch("/api/feedback", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          incidentId: id,
          incident,
          success,
          rootCause: fields.rootCause?.trim() || undefined,
          timeToResolve: fields.timeToResolve?.trim() || undefined,
          resolutionSteps: withRes?.suggestion.steps,
        }),
      });
      const data = (await res.json()) as FeedbackResponse & { error?: string };
      if (!res.ok) throw new Error(data?.error ?? "Feedback failed");

      setFeedback(data);
      setIncident(data.incident);

      const stats = data.stats;
      toast({
        variant: data.retained ? "success" : "destructive",
        title: data.retained
          ? success
            ? "Learned — fix retained in memory"
            : "Learned — failure retained in memory"
          : "Feedback saved, memory write failed",
        description: data.retained
          ? stats
            ? `${stats.signature}: ${stats.successes}/${stats.attempts} successful (rate ${stats.rate.toFixed(2)})`
            : "The next similar incident will be answered from this experience."
          : (data.memoryError ?? "Hindsight was unreachable."),
      });

      // The live counter ticks while the judge is still looking at this screen.
      if (data.retained) bump();

      // Ranking-shift reveal: re-run recall() and diff against the snapshot
      // the user was just shown.
      const before = preFeedback.current;
      if (data.retained && before && before.length > 0) {
        setShiftStatus({ kind: "loading" });
        try {
          const rerankRes = await fetch("/api/rerank", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ incidentId: id, incident: data.incident }),
          });
          const rerank = (await rerankRes.json()) as RerankResponse & { error?: string };
          if (!rerankRes.ok) throw new Error(rerank.error ?? "Re-ranking failed");

          const shift = computeRankingShift(before, rerank.candidates, {
            incidentSignature: data.incident.errorSignature,
            liveRecordId: `live-${id}`,
            chosenRecordId: data.incident.chosenRecordId,
          });
          setShiftStatus(
            shift
              ? { kind: "ready", shift, success }
              : {
                  kind: "error",
                  message:
                    "The fresh recall returned no matching candidates for this signature yet.",
                },
          );
        } catch (err) {
          setShiftStatus({
            kind: "error",
            message:
              err instanceof Error
                ? err.message
                : "Could not recompute the ranking from Hindsight.",
          });
        }
      }
    } catch (err) {
      toast({
        variant: "destructive",
        title: "Could not save feedback",
        description: err instanceof Error ? err.message : "Unknown error",
      });
    } finally {
      setFeedbackSubmitting(false);
    }
  }

  if (loadError) {
    return (
      <EmptyState
        icon={Terminal}
        title="Incident not found"
        description={loadError}
        action={
          <Link href="/" className="text-xs font-medium text-emerald-300 underline-offset-4 hover:underline">
            ← Back to dashboard
          </Link>
        }
      />
    );
  }

  if (!incident) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-6 w-40" />
        <Skeleton className="h-32 w-full" />
        <Skeleton className="h-64 w-full" />
      </div>
    );
  }

  const anyLoading = loadingWith || loadingWithout;

  return (
    <div className="space-y-6">
      <Link
        href="/"
        className="inline-flex items-center gap-1.5 text-xs font-medium text-muted-foreground transition-colors hover:text-foreground"
      >
        <ArrowLeft className="size-3.5" />
        Dashboard
      </Link>

      {/* Incident report header */}
      <div className="space-y-3">
        <div className="flex flex-wrap items-center gap-2">
          <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">
            {incident.service}
          </h1>
          <SeverityBadge severity={incident.severity} />
        </div>

        <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 text-xs text-muted-foreground">
          <span className="flex items-center gap-1.5">
            <Clock className="size-3.5" />
            {new Date(incident.timestamp).toLocaleString()}
          </span>
          {incident.errorSignature ? (
            <span className="flex items-center gap-1.5 font-mono">
              <Fingerprint className="size-3.5" />
              {incident.errorSignature}
            </span>
          ) : null}
        </div>

        <div className="rounded-lg border border-border/70 bg-muted/30 p-3">
          <pre className="overflow-x-auto font-mono text-xs leading-relaxed whitespace-pre-wrap text-foreground/85">
            {incident.error}
          </pre>
        </div>
      </div>

      {/* Comparison controls: switch on narrow screens, explainer on desktop */}
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="lg:hidden">
          <p className="mb-2 text-xs font-medium text-muted-foreground">
            Response mode
          </p>
          <MemoryToggle
            value={mobileMode === "with"}
            onChange={(m) => setMobileMode(m ? "with" : "without")}
            disabled={anyLoading}
          />
        </div>
        <p className="hidden max-w-2xl text-xs leading-relaxed text-muted-foreground lg:block">
          Same model, same incident — both answers below were generated in parallel;
          the only difference is whether Hindsight recall() ran and what it handed
          to Groq.
        </p>
        {anyLoading ? (
          <span className="flex items-center gap-2 pb-1 text-xs text-muted-foreground">
            <LoaderCircle className="size-3.5 animate-spin" />
            {loadingWith && loadingWithout
              ? "Generating both answers in parallel…"
              : loadingWith
                ? "Recalling from Hindsight…"
                : "Answering without memory…"}
          </span>
        ) : null}
      </div>

      {/* Desktop: true side-by-side comparison */}
      <div className="hidden lg:grid lg:grid-cols-2 lg:items-start lg:gap-4">
        <AgentSuggestion
          mode="without"
          loading={loadingWithout}
          error={errWithout}
          result={withoutRes}
          onRetry={() => runSuggest(false)}
        />
        <AgentSuggestion
          mode="with"
          loading={loadingWith}
          error={errWith}
          result={withRes}
          onRetry={() => runSuggest(true)}
        />
      </div>

      {/* Mobile: one column at a time */}
      <div className="lg:hidden">
        {mobileMode === "with" ? (
          <AgentSuggestion
            mode="with"
            loading={loadingWith}
            error={errWith}
            result={withRes}
            onRetry={() => runSuggest(true)}
          />
        ) : (
          <AgentSuggestion
            mode="without"
            loading={loadingWithout}
            error={errWithout}
            result={withoutRes}
            onRetry={() => runSuggest(false)}
          />
        )}
      </div>

      {/* Feedback + the ranking-shift reveal (rendered exactly once) */}
      {!loadingWith && !errWith && withRes ? (
        <div className="space-y-4">
          <FeedbackPanel
            suggestionSteps={withRes.suggestion.steps}
            feedback={feedback}
            submitting={feedbackSubmitting}
            disabled={feedbackSubmitting}
            onSubmit={onFeedback}
          />
          {shiftStatus ? <RankingShiftPanel status={shiftStatus} /> : null}
        </div>
      ) : null}
    </div>
  );
}
