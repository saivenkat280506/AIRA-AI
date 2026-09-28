"use client";

import { useState } from "react";
import Link from "next/link";
import { CircleCheck, CircleX, LoaderCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";
import type { FeedbackResponse, SignatureStats } from "@backend/types";

/**
 * Feedback loop — the mechanism by which the agent learns.
 *   "This fixed it"     → retain(success=true)
 *   "This did not help" → retain(success=false)  [kept so the fix's rate drops]
 */
export function FeedbackPanel({
  suggestionSteps,
  feedback,
  submitting,
  disabled,
  onSubmit,
}: {
  suggestionSteps: string[];
  feedback: FeedbackResponse | null;
  submitting: boolean;
  disabled: boolean;
  onSubmit: (success: boolean, fields: { rootCause?: string; timeToResolve?: string }) => void;
}) {
  const [rootCause, setRootCause] = useState("");
  const [timeToResolve, setTimeToResolve] = useState("");

  if (feedback) {
    return <LearnedCard feedback={feedback} />;
  }

  return (
    <div className="rounded-lg border border-border/70 bg-muted/20 p-4">
      <div className="space-y-3">
        <div>
          <p className="text-sm font-medium">Did this fix it?</p>
          <p className="text-xs text-muted-foreground">
            Your answer is retained with the incident, suggestion and outcome — this is how
            the agent gets sharper for next time.
          </p>
        </div>

        <div className="grid gap-3 sm:grid-cols-2">
          <div className="grid gap-1.5">
            <Label htmlFor="root-cause" className="text-xs">
              Root cause <span className="text-muted-foreground">(optional)</span>
            </Label>
            <Input
              id="root-cause"
              placeholder="e.g. connection pool exhaustion"
              value={rootCause}
              onChange={(e) => setRootCause(e.target.value)}
              disabled={submitting || disabled}
              className="h-8 text-xs"
            />
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="ttr" className="text-xs">
              Time to resolve <span className="text-muted-foreground">(optional)</span>
            </Label>
            <Input
              id="ttr"
              placeholder="e.g. 35 minutes"
              value={timeToResolve}
              onChange={(e) => setTimeToResolve(e.target.value)}
              disabled={submitting || disabled}
              className="h-8 text-xs"
            />
          </div>
        </div>

        <div className="flex flex-wrap gap-2">
          <Button
            variant="outline"
            className="border-emerald-500/40 bg-emerald-500/10 text-emerald-300 hover:bg-emerald-500/20 hover:text-emerald-200"
            disabled={submitting || disabled}
            onClick={() => onSubmit(true, { rootCause, timeToResolve })}
          >
            {submitting ? <LoaderCircle className="size-4 animate-spin" /> : <CircleCheck className="size-4" />}
            This fixed it
          </Button>
          <Button
            variant="outline"
            className="border-red-500/40 bg-red-500/10 text-red-300 hover:bg-red-500/20 hover:text-red-200"
            disabled={submitting || disabled}
            onClick={() => onSubmit(false, { rootCause, timeToResolve })}
          >
            {submitting ? <LoaderCircle className="size-4 animate-spin" /> : <CircleX className="size-4" />}
            This did not help
          </Button>
          {suggestionSteps.length > 0 ? (
            <span className="self-center text-[11px] text-muted-foreground">
              {suggestionSteps.length} suggested steps will be retained with the outcome
            </span>
          ) : null}
        </div>
      </div>
    </div>
  );
}

function LearnedCard({ feedback }: { feedback: FeedbackResponse }) {
  const { incident, retained, stats, memoryError } = feedback;
  const ok = incident.success === true;

  return (
    <div
      className={cn(
        "rounded-lg border p-4",
        retained
          ? "border-emerald-500/40 bg-emerald-500/[0.06]"
          : "border-amber-500/40 bg-amber-500/[0.06]",
      )}
    >
      <div className="flex items-start gap-3">
        <span
          className={cn(
            "mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-md",
            retained ? "bg-emerald-500/20 text-emerald-300" : "bg-amber-500/20 text-amber-300",
          )}
        >
          {retained ? <CircleCheck className="size-4" /> : <CircleX className="size-4" />}
        </span>
        <div className="min-w-0 space-y-1.5">
          <p className="text-sm font-medium">
            {retained ? "Learned — experience retained in memory" : "Feedback saved locally"}
          </p>
          <p className="text-xs leading-relaxed text-muted-foreground">
            {ok
              ? "Marked as fixed. This resolution now counts toward the error signature's success rate."
              : "Marked as not helpful. This failure stays in memory and lowers the fix's future success rate instead of being discarded."}
          </p>

          {stats ? <SignatureStatsLine stats={stats} /> : null}

          {memoryError ? (
            <p className="text-xs text-amber-300/90">
              Memory write failed: {memoryError}. The feedback is stored locally and will not
              affect ranking until Hindsight is reachable.
            </p>
          ) : null}

          <Link
            href="/memory"
            className="inline-block text-xs font-medium text-emerald-300 underline-offset-4 hover:underline"
          >
            View memory →
          </Link>
        </div>
      </div>
    </div>
  );
}

function SignatureStatsLine({ stats }: { stats: SignatureStats }) {
  return (
    <p className="rounded-md border border-border/60 bg-background/60 px-2.5 py-1.5 font-mono text-[11px] text-muted-foreground">
      {stats.signature} → {stats.successes}/{stats.attempts} successful · smoothed rate{" "}
      <span className="text-foreground">{stats.rate.toFixed(2)}</span>
    </p>
  );
}
