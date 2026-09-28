"use client";

import { AlertTriangle, ArrowDown, ArrowRight, ArrowUp, Minus, RefreshCw, Sparkles } from "lucide-react";
import { CountUp } from "@/components/CountUp";
import { cn } from "@/lib/utils";
import type { RankedCandidate } from "@backend/types";

/**
 * The ranking-shift reveal: shown right below the feedback controls after
 * retain() succeeds and a fresh recall()+ranking has come back.
 *
 * It diffs the pre-feedback snapshot (kept in component state by the incident
 * page — no second round-trip for the "before") against the fresh list and
 * states, in plain language, exactly what the feedback moved:
 *   - the candidate whose steps were actually suggested and rated (old vs new
 *     success value),
 *   - the just-retained experience entering the ranking and where it landed,
 *   - whether the rank order changed (and what moved) or did not.
 */

export type RankChangeKind = "up" | "down" | "same" | "dropped";

export interface RankingShift {
  /** The pre-feedback candidate whose suggested steps the user rated. */
  anchor: RankedCandidate;
  /** The same candidate in the fresh ranking (undefined = dropped out of top-N). */
  anchorAfter?: RankedCandidate;
  beforeRank: number;
  afterRank?: number;
  rateBefore: number;
  /** undefined when the candidate dropped out of the fresh top matches. */
  rateAfter?: number;
  scoreBefore: number;
  scoreAfter?: number;
  /** Movement of the rated (anchor) candidate. */
  rankChange: RankChangeKind;
  /** The ranked list itself changed (membership or order). */
  orderChanged: boolean;
  /** The #1 candidate changed identity as a result of the feedback. */
  topChanged: boolean;
  newTop?: RankedCandidate;
  /** The freshly retained live record entered the fresh top matches. */
  entered?: RankedCandidate;
}

export interface RankingShiftInput {
  /** Error signature of the incident (fallback anchor lookup). */
  incidentSignature?: string;
  /** recordId of the retained experience: `live-<incidentId>`. */
  liveRecordId: string;
  /** recordId of the candidate whose steps were suggested (from the incident). */
  chosenRecordId?: string;
}

/**
 * Pure diff between the pre-feedback ranking and the fresh one.
 * Anchor = the candidate whose steps were suggested and rated (chosenRecordId),
 * falling back to the first same-signature candidate, then to the previous #1.
 */
export function computeRankingShift(
  before: RankedCandidate[],
  after: RankedCandidate[],
  input: RankingShiftInput,
): RankingShift | null {
  if (before.length === 0) return null;

  const anchor =
    (input.chosenRecordId
      ? before.find((c) => c.experience.recordId === input.chosenRecordId)
      : undefined) ??
    (input.incidentSignature
      ? before.find((c) => c.experience.errorSignature === input.incidentSignature)
      : undefined) ??
    before[0];
  const beforeRank = anchor.rank;
  const anchorAfter = after.find(
    (c) => c.experience.recordId === anchor.experience.recordId,
  );

  const rankChange: RankChangeKind = !anchorAfter
    ? "dropped"
    : anchorAfter.rank === beforeRank
      ? "same"
      : anchorAfter.rank < beforeRank
        ? "up"
        : "down";

  const orderChanged =
    before.map((c) => c.experience.recordId).join("|") !==
    after.map((c) => c.experience.recordId).join("|");

  const newTop = after[0];
  const topChanged =
    Boolean(newTop) && newTop.experience.recordId !== before[0].experience.recordId;
  const entered = after.find((c) => c.experience.recordId === input.liveRecordId);

  return {
    anchor,
    anchorAfter,
    beforeRank,
    afterRank: anchorAfter?.rank,
    rateBefore: anchor.successRate,
    rateAfter: anchorAfter?.successRate,
    scoreBefore: anchor.score,
    scoreAfter: anchorAfter?.score,
    rankChange,
    orderChanged,
    topChanged: topChanged && newTop !== undefined,
    newTop: topChanged ? newTop : undefined,
    entered,
  };
}

function fmtDate(iso?: string): string {
  if (!iso) return "unknown";
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "unknown" : d.toISOString().slice(0, 10);
}

/** Plain-language statement: did the rank order change, and what moved? */
function orderSentence(s: RankingShift): string {
  if (!s.orderChanged) {
    return `The order did not change — the rated fix is still #${s.beforeRank}.`;
  }
  const move =
    s.rankChange === "dropped"
      ? "the rated fix dropped out of the top matches"
      : s.rankChange === "up"
        ? `the rated fix climbed from #${s.beforeRank} to #${s.afterRank}`
        : s.rankChange === "down"
          ? `the rated fix moved from #${s.beforeRank} to #${s.afterRank}`
          : `the rated fix held at #${s.beforeRank} while the rest of the list reordered`;
  return `The order changed after your feedback — ${move}.`;
}

export type RankingShiftStatus =
  | { kind: "loading" }
  | { kind: "error"; message: string }
  | { kind: "ready"; shift: RankingShift; success: boolean };

export function RankingShiftPanel({
  status,
}: {
  status: RankingShiftStatus;
}) {
  if (status.kind === "loading") {
    return (
      <div className="animate-in fade-in-0 slide-in-from-bottom-2 duration-500 rounded-lg border border-border/70 bg-muted/20 p-4">
        <div className="flex items-start gap-3">
          <RefreshCw className="mt-0.5 size-4 shrink-0 animate-spin text-emerald-400" />
          <div className="space-y-1">
            <p className="text-sm font-medium">Recomputing the ranking…</p>
            <p className="text-xs leading-relaxed text-muted-foreground">
              Your feedback is already retained in Hindsight. Re-running recall() for this
              error signature to show what moved.
            </p>
          </div>
        </div>
      </div>
    );
  }

  if (status.kind === "error") {
    return (
      <div className="animate-in fade-in-0 duration-500 rounded-lg border border-amber-500/40 bg-amber-500/[0.07] p-4">
        <div className="flex items-start gap-2.5">
          <AlertTriangle className="mt-0.5 size-4 shrink-0 text-amber-300" />
          <div className="space-y-1">
            <p className="text-sm font-medium text-amber-200">
              Feedback retained — ranking view unavailable
            </p>
            <p className="text-xs text-muted-foreground">{status.message}</p>
          </div>
        </div>
      </div>
    );
  }

  const s = status.shift;
  const e = s.anchor.experience;
  // Deltas are computed from the values actually displayed (2dp) so the hint
  // always matches the visible before → after pair.
  const r2 = (n: number) => Math.round(n * 100) / 100;
  const rateDelta =
    s.rateAfter !== undefined ? r2(s.rateAfter) - r2(s.rateBefore) : undefined;
  const scoreDelta =
    s.scoreAfter !== undefined ? r2(s.scoreAfter) - r2(s.scoreBefore) : undefined;
  const rankIcon =
    s.rankChange === "up" ? (
      <ArrowUp className="size-3.5" />
    ) : s.rankChange === "same" ? (
      <Minus className="size-3.5" />
    ) : (
      <ArrowDown className="size-3.5" />
    );
  const orderTone = s.rankChange === "dropped"
    ? "border-red-500/40 bg-red-500/[0.07] text-red-200"
    : s.orderChanged
      ? "border-emerald-500/40 bg-emerald-500/[0.07] text-emerald-200"
      : "border-sky-500/30 bg-sky-500/[0.06] text-sky-200";

  return (
    <div className="animate-in fade-in-0 slide-in-from-bottom-2 duration-500 space-y-3.5 rounded-lg border border-emerald-500/40 bg-emerald-500/[0.05] p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="flex items-center gap-2 text-sm font-medium text-emerald-200">
          <Sparkles className="size-4 text-emerald-300" />
          Ranking recomputed after retain()
        </p>
        <span className="font-mono text-[10px] text-muted-foreground">
          fresh recall() · post-feedback
        </span>
      </div>

      {/* The candidate whose steps were suggested and rated */}
      <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1.5">
        <span className="text-sm font-semibold">{e.service}</span>
        <span className="font-mono text-[10px] text-muted-foreground">{e.recordId}</span>
        <span className="font-mono text-[10px] text-muted-foreground/70">
          {e.errorSignature ?? "unknown signature"}
        </span>
        <span className="text-[10px] text-muted-foreground">
          occurred {fmtDate(e.occurredAt)}
        </span>
        <span className="rounded-full border border-border/70 bg-background/70 px-2 py-0.5 text-[10px] text-muted-foreground">
          the suggested fix you rated
        </span>
      </div>

      {/* Animated before → after numbers for the rated candidate */}
      <div className="grid gap-2.5 sm:grid-cols-2">
        <div className="rounded-md border border-border/60 bg-background/60 p-3">
          <p className="text-[11px] text-muted-foreground">Success-rate component</p>
          <p className="mt-1 flex items-baseline gap-2 text-lg font-semibold tabular-nums">
            <span className="text-sm font-normal text-muted-foreground">
              {s.rateBefore.toFixed(2)}
            </span>
            <ArrowRight className="size-4 text-muted-foreground" />
            <CountUp value={s.rateAfter ?? s.rateBefore} from={s.rateBefore} decimals={2} />
          </p>
          <p
            className={cn(
              "mt-1 flex flex-wrap items-center gap-x-1 text-[11px] font-medium",
              rateDelta === undefined
                ? "text-muted-foreground"
                : rateDelta > 0
                  ? "text-emerald-300"
                  : rateDelta < 0
                    ? "text-amber-300"
                    : "text-muted-foreground",
            )}
          >
            {rateDelta !== undefined && rateDelta !== 0 ? (
              rateDelta > 0 ? (
                <ArrowUp className="size-3" />
              ) : (
                <ArrowDown className="size-3" />
              )
            ) : null}
            {rateDelta === undefined ? (
              s.anchorAfter
                ? "unchanged"
                : "new rate unknown — dropped from recall"
            ) : rateDelta === 0 ? (
              "unchanged"
            ) : (
              <>
                {`${rateDelta > 0 ? "+" : ""}${rateDelta.toFixed(2)} after your feedback`}
                {s.anchorAfter ? (
                  <span className="font-normal text-muted-foreground">
                    {" "}
                    · approach {s.anchor.successes}/{s.anchor.attempts} →{" "}
                    {s.anchorAfter.successes}/{s.anchorAfter.attempts}
                  </span>
                ) : null}
              </>
            )}
          </p>
        </div>

        <div className="rounded-md border border-border/60 bg-background/60 p-3">
          <p className="text-[11px] text-muted-foreground">Overall score (0.55·sim + 0.30·rate + 0.15·recency)</p>
          <p className="mt-1 flex items-baseline gap-2 text-lg font-semibold tabular-nums">
            <span className="text-sm font-normal text-muted-foreground">
              {s.scoreBefore.toFixed(2)}
            </span>
            <ArrowRight className="size-4 text-muted-foreground" />
            <CountUp
              value={s.scoreAfter ?? s.scoreBefore}
              from={s.scoreBefore}
              decimals={2}
            />
          </p>
          <p className="mt-1 text-[11px] text-muted-foreground">
            {scoreDelta === undefined
              ? "not in the new top matches"
              : scoreDelta === 0
                ? "unchanged"
                : `${scoreDelta > 0 ? "+" : ""}${scoreDelta.toFixed(2)}`}
            {s.anchorAfter ? ` · now rank #${s.afterRank}` : ""}
          </p>
        </div>
      </div>

      {/* The just-retained experience entering the ranking */}
      {s.entered ? (
        <p className="flex items-center gap-1.5 text-xs text-emerald-300">
          <Sparkles className="size-3.5 shrink-0" />
          <span>
            <span className="font-semibold">New entry ranks #{s.entered.rank}</span> —{" "}
            <span className="font-mono text-[10px]">{s.entered.experience.recordId}</span>{" "}
            retained from this feedback.
          </span>
        </p>
      ) : null}

      {/* Plain-language order statement — always present, even when nothing moved */}
      <p
        className={cn(
          "flex items-start gap-2 rounded-md border px-3 py-2 text-sm",
          orderTone,
        )}
      >
        <span className="mt-0.5 shrink-0">{rankIcon}</span>
        <span>{orderSentence(s)}</span>
      </p>

      {s.topChanged &&
      s.newTop &&
      s.newTop.experience.recordId !== s.entered?.experience.recordId ? (
        <p className="text-xs text-muted-foreground">
          New top match:{" "}
          <span className="font-medium text-foreground">
            {s.newTop.experience.service}
          </span>{" "}
          <span className="font-mono text-[10px]">{s.newTop.experience.recordId}</span>{" "}
          at #1 (score {s.newTop.score.toFixed(2)}).
        </p>
      ) : null}

      <p className="text-[11px] leading-relaxed text-muted-foreground">
        {status.success
          ? "This outcome is now part of the bank — the next similar incident will recall it."
          : "The failed attempt is kept in memory on purpose so this fix's success rate drops instead of being forgotten."}
      </p>
    </div>
  );
}
