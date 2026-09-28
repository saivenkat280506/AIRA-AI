"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { LoaderCircle, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "@/components/ui/use-toast";
import type { Severity } from "@/lib/types";

const SEVERITIES: { value: Severity; label: string }[] = [
  { value: "critical", label: "Critical — pager now" },
  { value: "high", label: "High — degraded impact" },
  { value: "medium", label: "Medium — partial impact" },
  { value: "low", label: "Low — cosmetic / noisy" },
];

/**
 * The rehearsed demo incident: Redis connection timeout on checkout-api.
 * The text is chosen so computeErrorSignature() lands on exactly
 * `checkout-api:redis-connection-timeout` — the seed lineage with 4 past
 * records (3 fixed / 1 restart-only failure) — so feedback visibly moves that
 * lineage's success rate in the ranking-shift reveal.
 */
const DEMO = {
  service: "checkout-api",
  severity: "critical" as Severity,
  error: "Redis connection timeout after 30s",
};

export function IncidentForm() {
  const router = useRouter();
  const [service, setService] = useState("");
  const [error, setError] = useState("");
  const [severity, setSeverity] = useState<Severity>("high");
  const [timestamp, setTimestamp] = useState("");
  const [submitting, setSubmitting] = useState(false);

  function prefillDemo() {
    setService(DEMO.service);
    setSeverity(DEMO.severity);
    setError(DEMO.error);
    toast({
      title: "Demo incident prefilled",
      description: "Submit it to see the ranked Hindsight recall in action.",
    });
  }

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (submitting) return;

    if (!service.trim() || !error.trim()) {
      toast({
        variant: "destructive",
        title: "Missing fields",
        description: "Service name and error message are required.",
      });
      return;
    }

    setSubmitting(true);
    try {
      const res = await fetch("/api/incident", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          service,
          error,
          severity,
          timestamp: timestamp ? new Date(timestamp).toISOString() : undefined,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error ?? "Failed to create incident");
      }
      toast({
        variant: "success",
        title: "Incident reported",
        description: "Running recall against past incidents…",
      });
      router.push(`/incident/${data.incident.id}`);
    } catch (err) {
      toast({
        variant: "destructive",
        title: "Could not report incident",
        description: err instanceof Error ? err.message : "Unknown error",
      });
      setSubmitting(false);
    }
  }

  return (
    <Card className="border-border/70">
      <CardHeader>
        <div className="space-y-1.5">
          <CardTitle className="text-base">Report an incident</CardTitle>
          <CardDescription>
            The agent recalls similar past incidents, ranks them, and suggests a fix.
          </CardDescription>
        </div>
        <CardAction>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={prefillDemo}
            disabled={submitting}
          >
            <Sparkles className="size-3.5" />
            Prefill demo
          </Button>
        </CardAction>
      </CardHeader>
      <CardContent>
        <form onSubmit={onSubmit} className="grid gap-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="grid gap-2">
              <Label htmlFor="service">Service name</Label>
              <Input
                id="service"
                placeholder="checkout-api"
                value={service}
                onChange={(e) => setService(e.target.value)}
                disabled={submitting}
                autoComplete="off"
              />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="severity">Severity</Label>
              <Select
                value={severity}
                onValueChange={(v) => setSeverity(v as Severity)}
                disabled={submitting}
              >
                <SelectTrigger id="severity" className="w-full">
                  <SelectValue placeholder="Severity" />
                </SelectTrigger>
                <SelectContent>
                  {SEVERITIES.map((s) => (
                    <SelectItem key={s.value} value={s.value}>
                      {s.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="grid gap-2">
            <Label htmlFor="error">Error message / log snippet</Label>
            <Textarea
              id="error"
              placeholder={
                "connect ETIMEDOUT 10.4.2.19:6379 — Redis connection to checkout-cache failed after 30000ms"
              }
              value={error}
              onChange={(e) => setError(e.target.value)}
              rows={4}
              disabled={submitting}
              className="font-mono text-xs"
            />
          </div>

          <div className="grid gap-2">
            <Label htmlFor="timestamp">
              Timestamp <span className="text-muted-foreground">(optional)</span>
            </Label>
            <Input
              id="timestamp"
              type="datetime-local"
              value={timestamp}
              onChange={(e) => setTimestamp(e.target.value)}
              disabled={submitting}
              className="sm:max-w-56"
            />
          </div>

          <div className="flex justify-end">
            <Button type="submit" disabled={submitting}>
              {submitting ? (
                <LoaderCircle className="size-4 animate-spin" />
              ) : null}
              Report incident
            </Button>
          </div>
        </form>
      </CardContent>
    </Card>
  );
}
