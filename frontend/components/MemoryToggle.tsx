"use client";

import { Ban, Brain } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * The single highest-value judging control:
 * same incident + same Groq call, with the Hindsight recall step either
 * executed (on) or skipped with empty context (off).
 */
export function MemoryToggle({
  value,
  onChange,
  disabled = false,
}: {
  value: boolean;
  onChange: (useMemory: boolean) => void;
  disabled?: boolean;
}) {
  const options = [
    { useMemory: false, label: "Without memory", icon: Ban },
    { useMemory: true, label: "With memory", icon: Brain },
  ] as const;

  return (
    <div className="flex flex-col gap-2">
      <div className="inline-flex w-fit items-center gap-1 rounded-lg border border-border/70 bg-muted/40 p-1">
        {options.map(({ useMemory, label, icon: Icon }) => {
          const active = value === useMemory;
          return (
            <button
              key={label}
              type="button"
              disabled={disabled}
              onClick={() => onChange(useMemory)}
              aria-pressed={active}
              className={cn(
                "flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium transition-all disabled:opacity-60",
                active
                  ? useMemory
                    ? "bg-emerald-500/15 text-emerald-300 shadow-sm ring-1 ring-emerald-500/40"
                    : "bg-background text-foreground shadow-sm ring-1 ring-border"
                  : "text-muted-foreground hover:text-foreground",
              )}
            >
              <Icon className="size-3.5" />
              {label}
            </button>
          );
        })}
      </div>
      <p className="text-[11px] leading-relaxed text-muted-foreground">
        {value
          ? "Hindsight recall() runs, past incidents are scored in app code, and Groq phrases a grounded suggestion."
          : "Recall is skipped and Groq receives empty context — identical model, identical incident."}
      </p>
    </div>
  );
}
