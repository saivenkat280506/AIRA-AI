"use client";

import { useEffect, useRef, useState } from "react";
import { cn } from "@/lib/utils";

/**
 * Animated numeric value.
 *
 * - Mount with `from` + `value` to animate the first render (the
 *   ranking-shift "0.67 → 0.71" moment).
 * - Afterwards it animates from the previous value to the new one whenever
 *   `value` changes (the "learned today" counter tick).
 */
export function CountUp({
  value,
  from,
  decimals = 0,
  duration = 600,
  className,
}: {
  value: number;
  from?: number;
  decimals?: number;
  duration?: number;
  className?: string;
}) {
  const initial = from ?? value;
  const [display, setDisplay] = useState(initial);
  const prevRef = useRef(initial);

  useEffect(() => {
    const start = prevRef.current;
    const end = value;
    if (start === end) {
      setDisplay(end);
      return;
    }

    let raf = 0;
    const t0 = performance.now();
    const tick = (t: number) => {
      const p = Math.min(1, (t - t0) / duration);
      // ease-out cubic: quick start, settles gently
      const eased = 1 - Math.pow(1 - p, 3);
      const current = start + (end - start) * eased;
      // Track the last *displayed* frame (not the target) so a StrictMode
      // effect re-run on mount restarts the animation instead of skipping it.
      prevRef.current = current;
      setDisplay(current);
      if (p < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [value, duration]);

  return (
    <span className={cn("tabular-nums", className)}>{display.toFixed(decimals)}</span>
  );
}
