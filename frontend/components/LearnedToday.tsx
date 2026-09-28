"use client";

import { createContext, useCallback, useContext, useEffect, useState } from "react";

/**
 * App-wide counter of retain() calls accepted today.
 *
 * Lives above the pages (layout-level provider) so a feedback submission on an
 * incident page bumps the header badge AND the dashboard stat immediately —
 * no refetch, no navigation, the number ticks while the judge is still on screen.
 */
interface LearnedTodayValue {
  /** null while the initial fetch is in flight. */
  count: number | null;
  bump: () => void;
}

const LearnedTodayContext = createContext<LearnedTodayValue>({
  count: null,
  bump: () => undefined,
});

export function LearnedTodayProvider({ children }: { children: React.ReactNode }) {
  const [count, setCount] = useState<number | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/incident?limit=1")
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        const today = d?.stats?.learnedToday;
        if (!cancelled && typeof today === "number") setCount(today);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, []);

  const bump = useCallback(() => setCount((c) => (c ?? 0) + 1), []);

  return (
    <LearnedTodayContext.Provider value={{ count, bump }}>
      {children}
    </LearnedTodayContext.Provider>
  );
}

export function useLearnedToday(): LearnedTodayValue {
  return useContext(LearnedTodayContext);
}
