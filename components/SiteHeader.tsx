"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { Activity, Brain, LayoutDashboard, Sparkles } from "lucide-react";
import { CountUp } from "@/components/CountUp";
import { useLearnedToday } from "@/components/LearnedToday";
import { cn } from "@/lib/utils";
import type { BackendStatus } from "@/lib/types";

const NAV = [
  { href: "/", label: "Dashboard", icon: LayoutDashboard },
  { href: "/memory", label: "Memory", icon: Brain },
] as const;

/** Sticky top bar: brand, nav, live backend status (honesty during demos). */
export function SiteHeader() {
  const pathname = usePathname();
  const [status, setStatus] = useState<BackendStatus | null>(null);
  const { count: learnedToday } = useLearnedToday();

  useEffect(() => {
    let cancelled = false;
    fetch("/api/memory")
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (!cancelled && d?.backends) setStatus(d.backends as BackendStatus);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, []);

  const memoryLive = status?.memory === "hindsight";
  const degraded = status?.degraded ?? false;

  return (
    <header className="sticky top-0 z-40 border-b border-border/70 bg-background/80 backdrop-blur-md">
      {/* Wraps to two rows on narrow screens so the status pills never clip;
          from sm up it is the usual single h-14 bar. */}
      <div className="mx-auto flex w-full max-w-6xl flex-wrap items-center justify-between gap-x-4 gap-y-1.5 px-4 py-2 sm:h-14 sm:flex-nowrap sm:gap-x-6 sm:px-6 sm:py-0">
        <div className="flex shrink-0 items-center gap-4 sm:gap-6">
          <Link href="/" className="flex shrink-0 items-center gap-2.5">
            <span className="flex size-7 items-center justify-center rounded-md bg-primary text-primary-foreground">
              <Activity className="size-4" />
            </span>
            <span className="text-sm font-semibold tracking-tight">
              AIRA
            </span>
            <span className="hidden text-xs text-muted-foreground sm:inline">
              Adaptive Incident Response
            </span>
          </Link>

          <nav className="flex shrink-0 items-center gap-1">
            {NAV.map(({ href, label, icon: Icon }) => {
              const active = href === "/" ? pathname === "/" : pathname.startsWith(href);
              return (
                <Link
                  key={href}
                  href={href}
                  className={cn(
                    "flex shrink-0 items-center gap-1.5 rounded-md px-2.5 py-1.5 text-xs font-medium transition-colors",
                    active
                      ? "bg-muted text-foreground"
                      : "text-muted-foreground hover:bg-muted/60 hover:text-foreground",
                  )}
                >
                  <Icon className="size-3.5" />
                  {label}
                </Link>
              );
            })}
          </nav>
        </div>

        <div className="ml-auto flex shrink-0 items-center gap-2">
          {/* Live learning counter — visible at every width, ticks the instant retain() succeeds */}
          <div
            title="retain() calls accepted today — updates the moment you rate an incident"
            className="flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-full border border-emerald-500/30 bg-emerald-500/10 px-2.5 py-1"
          >
            <Sparkles
              key={learnedToday ?? "loading"}
              className="size-3 animate-in fade-in-0 text-emerald-300 duration-500"
            />
            <span className="text-[11px] font-medium text-emerald-200">
              <CountUp value={learnedToday ?? 0} /> learned today
            </span>
          </div>

          <div
            title={
              status
                ? `Memory: ${status.memoryDetail}\nLLM: ${status.llmDetail}${status.note ? `\n${status.note}` : ""}`
                : "Checking backends…"
            }
            className="flex shrink-0 items-center gap-2 whitespace-nowrap rounded-full border border-border/70 bg-muted/40 px-2.5 py-1"
          >
            <span
              className={cn(
                "size-1.5 rounded-full",
                degraded
                  ? "bg-amber-400"
                  : status
                    ? memoryLive
                      ? "bg-emerald-400"
                      : "bg-sky-400"
                    : "bg-muted-foreground/50",
              )}
            />
            <span className="text-[11px] font-medium text-muted-foreground">
              {status
                ? degraded
                  ? "degraded"
                  : memoryLive
                    ? "Hindsight live"
                    : "fallback memory"
                : "…"}
            </span>
          </div>
        </div>
      </div>
    </header>
  );
}
