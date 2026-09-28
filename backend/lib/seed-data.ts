import type { Severity } from "./types";

/**
 * Demo seed corpus — 15 synthetic past incidents across varied services.
 *
 * The core demo scenario is "Redis connection timeout", intentionally present
 * as THREE near-duplicate variants (different services, different resolutions,
 * different stored success rates) so live recall visibly has to CHOOSE among
 * ranked candidates instead of echoing a single stored row:
 *
 *   A. checkout-api:redis-connection-timeout  -> 3 of 4 fixed
 *   B. payments-api:redis-connection-timeout  -> 1 of 3 fixed
 *   C. search-api:redis-timeout-under-load    -> 2 of 2 fixed
 *
 * Each record also carries a `resolutionApproach` label: ranking blends the
 * record's OWN outcome with the aggregate over records sharing that approach,
 * so a failed fix sinks below successful ones even when its text matches well.
 *
 * `daysAgo` is resolved to an ISO timestamp at seed/retain time so the
 * recency component of the ranking stays meaningful whenever the demo runs.
 */
export interface SeedIncident {
  id: string;
  daysAgo: number;
  service: string;
  error: string;
  severity: Severity;
  errorSignature: string;
  rootCause: string;
  resolutionSteps: string[];
  timeToResolve: string;
  success: boolean;
  /** Short label for the resolution approach — groups records by HOW they fixed it. */
  resolutionApproach: string;
}

export const SEED_INCIDENTS: SeedIncident[] = [
  // ── Variant A: checkout-api (4 records: 3 success, 1 failure) ─────────────
  {
    id: "seed-01",
    daysAgo: 55,
    service: "checkout-api",
    error:
      "connect ETIMEDOUT 10.4.2.19:6379 — Redis connection to checkout-cache failed after 30000ms",
    severity: "critical",
    errorSignature: "checkout-api:redis-connection-timeout",
    rootCause:
      "Redis client connection pool exhausted (maxConnections 51) during a flash-sale burst; every request queued waiting for a socket and timed out at 30s.",
    resolutionSteps: [
      "Raised ioredis maxConnections from 51 to 512",
      "Enabled exponential-backoff retry with jitter on connect",
      "Added pool-utilization alarm at 70%",
    ],
    timeToResolve: "42 minutes",
    success: true,
    resolutionApproach:
      "Raise ioredis maxConnections with backoff retry",
  },
  {
    id: "seed-02",
    daysAgo: 40,
    service: "checkout-api",
    error:
      "Redis connection timeout: GET operation exceeded 30000ms waiting for pool",
    severity: "high",
    errorSignature: "checkout-api:redis-connection-timeout",
    rootCause:
      "Same pool exhaustion, amplified by an unindexed cart:items:* key scan holding sockets open; queue wait exceeded the 30s client timeout.",
    resolutionSteps: [
      "Capped per-request pool wait at 2s and shed load with 503",
      "Replaced the cart:items:* scan with a secondary index",
      "Scaled the Redis primary shard",
    ],
    timeToResolve: "1 hour 10 minutes",
    success: true,
    resolutionApproach:
      "Cap pool wait, shed load, index the hot key",
  },
  {
    id: "seed-03",
    daysAgo: 26,
    service: "checkout-api",
    error:
      "connect ETIMEDOUT 10.4.2.19:6379 — Redis connection to checkout-cache failed after 30000ms",
    severity: "critical",
    errorSignature: "checkout-api:redis-connection-timeout",
    rootCause:
      "On-call only restarted the pod; no pool configuration change, so the timeouts returned within hours.",
    resolutionSteps: [
      "kubectl rollout restart checkout-api",
      "(no configuration change made)",
    ],
    timeToResolve: "12 minutes",
    success: false,
    resolutionApproach:
      "Restart the pod only — no config change",
  },
  {
    id: "seed-04",
    daysAgo: 19,
    service: "checkout-api",
    error:
      "ECONNRESET Redis connection to checkout-cache lost during checkout burst",
    severity: "high",
    errorSignature: "checkout-api:redis-connection-timeout",
    rootCause:
      "Instance ran an old ioredis build with retries disabled and default pool sizing; sockets were reset under burst traffic.",
    resolutionSteps: [
      "Upgraded ioredis to 5.x with retryStrategy backoff",
      "Set maxConnections 512",
      "Added TIME-WAIT socket dashboard",
    ],
    timeToResolve: "35 minutes",
    success: true,
    resolutionApproach:
      "Upgrade the Redis client and enable retries",
  },

  // ── Variant B: payments-api (3 records: 1 success, 2 failures) ────────────
  {
    id: "seed-05",
    daysAgo: 17,
    service: "payments-api",
    error:
      "Redis connection timeout while writing ledger entries (exceeded 30000ms)",
    severity: "high",
    errorSignature: "payments-api:redis-connection-timeout",
    rootCause:
      "Raised the client timeout to 10s instead of fixing the pool — masked the error, which then surfaced as downstream settlement lag.",
    resolutionSteps: ["Set commandTimeout 10000ms", "(no pool change)"],
    timeToResolve: "20 minutes",
    success: false,
    resolutionApproach:
      "Raise the client command timeout (mask)",
  },
  {
    id: "seed-06",
    daysAgo: 11,
    service: "payments-api",
    error:
      "connect ETIMEDOUT payments-redis:6379 — too many open connections from workers",
    severity: "critical",
    errorSignature: "payments-api:redis-connection-timeout",
    rootCause:
      "Each of the 1000 ledger workers opened its own connection instead of pooling; the rollout also missed the REDIS_POOL_SIZE env var.",
    resolutionSteps: [
      "Switched workers to a shared pooled client",
      "Deploy missed REDIS_POOL_SIZE — fix pending in next release",
    ],
    timeToResolve: "55 minutes",
    success: false,
    resolutionApproach:
      "Switch workers to a shared pooled client",
  },
  {
    id: "seed-07",
    daysAgo: 6,
    service: "payments-api",
    error:
      "Redis connection timeout during settlement batch (connect ETIMEDOUT payments-redis:6379)",
    severity: "high",
    errorSignature: "payments-api:redis-connection-timeout",
    rootCause:
      "Workers were pooled but the settlement batch spiked past the 200-connection cap, starving interactive traffic.",
    resolutionSteps: [
      "Raised maxConnections from 200 to 600",
      "Serialized settlement writes through a bounded queue",
      "Alert on pool wait > 500ms",
    ],
    timeToResolve: "28 minutes",
    success: true,
    resolutionApproach:
      "Raise maxConnections and serialize batch writes",
  },

  // ── Variant C: search-api (2 records: 2 successes) ────────────────────────
  {
    id: "seed-08",
    daysAgo: 12,
    service: "search-api",
    error:
      "redis: connection timeout under load — cache tier (search-api) connect ETIMEDOUT",
    severity: "medium",
    errorSignature: "search-api:redis-timeout-under-load",
    rootCause:
      "Cache-tier maxIdleConnections was too low; idle sockets were closed by the server-side `timeout 300` and reused before reconnect finished.",
    resolutionSteps: [
      "Raised maxIdleConnections from 8 to 64",
      "Set keepAlive 60s to defeat server-side idle close",
    ],
    timeToResolve: "22 minutes",
    success: true,
    resolutionApproach:
      "Raise maxIdleConnections with keepAlive",
  },
  {
    id: "seed-09",
    daysAgo: 4,
    service: "search-api",
    error:
      "Redis connection timeout when reindexing catalogs (search-api cache tier connect ETIMEDOUT)",
    severity: "high",
    errorSignature: "search-api:redis-timeout-under-load",
    rootCause:
      "The catalog reindex job shared the query cache pool, so reindexing starved interactive query traffic of sockets.",
    resolutionSteps: [
      "Gave the reindex job its own pool (maxConnections 128)",
      "Rate-limited reindexing to 50 req/s",
    ],
    timeToResolve: "31 minutes",
    success: true,
    resolutionApproach:
      "Isolate the reindex job onto its own pool",
  },

  // ── Other error types across the stack ────────────────────────────────────
  {
    id: "seed-10",
    daysAgo: 50,
    service: "ledger-api",
    error:
      'deadlock detected on relation "ledger_entries" — transaction aborted',
    severity: "high",
    errorSignature: "ledger-api:postgres-deadlock-ledger-entries",
    rootCause:
      "Settlement and refund jobs updated the same ledger rows in opposite order, deadlocking under concurrent traffic.",
    resolutionSteps: [
      "Ordered all updates by account_id in both jobs",
      "Set lock_timeout 5s with bounded retry",
    ],
    timeToResolve: "1 hour 05 minutes",
    success: true,
    resolutionApproach:
      "Order ledger updates and bound lock wait",
  },
  {
    id: "seed-11",
    daysAgo: 33,
    service: "events-worker",
    error: "Container OOMKilled: kafka-consumer heap 2Gi exceeded",
    severity: "critical",
    errorSignature: "events-worker:kafka-consumer-oom",
    rootCause:
      "After a consumer-group rebalance, one pod buffered ~500k unacked messages and blew past its heap limit.",
    resolutionSteps: [
      "Lowered max.poll.records from 500 to 100",
      "Raised heap to 4Gi with a matching container limit",
      "Added lag-based autoscaling",
    ],
    timeToResolve: "48 minutes",
    success: true,
    resolutionApproach:
      "Tune consumer batch size and raise heap",
  },
  {
    id: "seed-12",
    daysAgo: 28,
    service: "metrics-store",
    error: "write error: no space left on device (ENOSPC)",
    severity: "high",
    errorSignature: "metrics-store:enospc-disk-full",
    rootCause:
      "Raw-sample retention was kept at 400 days, filling the volume to 97% and blocking writes.",
    resolutionSteps: [
      "Cut raw retention from 400d to 14d (rollups kept longer)",
      "Added an 85% disk waterline alert",
    ],
    timeToResolve: "1 hour 22 minutes",
    success: true,
    resolutionApproach:
      "Cut retention and add a disk waterline alert",
  },
  {
    id: "seed-13",
    daysAgo: 22,
    service: "edge-gateway",
    error:
      "x509: certificate has expired or is not yet valid (edge-gateway TLS handshake failed)",
    severity: "critical",
    errorSignature: "edge-gateway:tls-cert-expired",
    rootCause:
      "ACME renewal cron was disabled during the cluster migration; the certificate expired at 00:00 UTC.",
    resolutionSteps: [
      "Re-issued the certificate with certbot",
      "Re-enabled the renewal cron and added a 21-day expiry alert",
    ],
    timeToResolve: "26 minutes",
    success: true,
    resolutionApproach:
      "Re-issue certificate and re-enable renewal cron",
  },
  {
    id: "seed-14",
    daysAgo: 15,
    service: "auth-service",
    error: "dial udp 10.2.0.10:53: i/o timeout — DNS resolution failing",
    severity: "high",
    errorSignature: "auth-service:dns-resolution-timeout",
    rootCause:
      "CoreDNS pod was evicted and resolv.conf still pointed at the dead node-local DNS endpoint.",
    resolutionSteps: [
      "Restarted CoreDNS and verified /etc/resolv.conf",
      "Set dnsPolicy ClusterFirst with a local node cache",
    ],
    timeToResolve: "19 minutes",
    success: true,
    resolutionApproach:
      "Restart CoreDNS and fix resolv.conf",
  },
  {
    id: "seed-15",
    daysAgo: 9,
    service: "web-bff",
    error: "502 Bad Gateway from upstream checkout-api (nginx)",
    severity: "medium",
    errorSignature: "web-bff:nginx-502-upstream",
    rootCause:
      "Upstream keepalive pool (8) was smaller than nginx worker_connections, so sockets were reset during bursts.",
    resolutionSteps: [
      "Matched upstream keepalive to worker capacity (64)",
      "Added proxy_next_upstream error timeout",
    ],
    timeToResolve: "17 minutes",
    success: true,
    resolutionApproach:
      "Match upstream keepalive to worker capacity",
  },
];

/** ISO timestamp for a seed incident, computed at call time (keeps recency fresh). */
export function seedTimestamp(daysAgo: number): string {
  return new Date(Date.now() - daysAgo * 24 * 60 * 60 * 1000).toISOString();
}
