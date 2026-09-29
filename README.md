# AIRA — Adaptive Incident Response Agent

An AI agent that helps SRE / DevOps teams resolve production incidents faster by
**remembering every past incident, root cause and successful resolution** using
[Hindsight](https://hindsight.vectorize.io) memory.

First time seeing a problem → generic advice.
After feedback is given → the next similar incident gets specific, proven suggestions
**visibly chosen among multiple ranked past candidates**.

Built for HackwithHyderabad 3.0. Stack: **Next.js 15 (App Router) · TypeScript ·
Tailwind CSS · shadcn/ui · Lucide · Groq (llama-3.3-70b / gpt-oss) · Hindsight Cloud**.

---

## Quick start

```bash
npm install
cp .env.example frontend/.env.local    # ONE canonical file — keys for app + seed script
npm run seed                           # load the 15-incident demo corpus into memory
npm run dev                            # http://localhost:3000
```

> **Env file location — canonical is `frontend/.env.local`:** Next.js resolves
> `.env.local` from its own project directory (`frontend/`), and `npm run seed` reads the
> same file, so a single copy serves both. Keeping keys only at the repo root is the
> classic trap here: the seed script would see them but the app would not, and it would
> silently boot into fallback mode (header shows `fallback memory`, not `Hindsight live`).
> A repo-root `.env.local` is still honored by the seed script as a legacy fallback, with
> a warning to move it.

Deployment: not hosted, run locally.

The app runs **without any Hindsight key** on a bundled local fallback memory backend
(same corpus, same retain/recall contract) so the demo never hangs on a blank screen.
With `HINDSIGHT_API_KEY` set, all memory flows through Hindsight Cloud automatically.

### Environment variables (`frontend/.env.local`)

| Variable | Required | Purpose |
| --- | --- | --- |
| `GROQ_API_KEY` | yes* | Groq API key — phrases the final suggestion |
| `GROQ_MODEL` | no | defaults to `llama-3.3-70b-versatile` (model availability varies per Groq account) |
| `HINDSIGHT_API_KEY` | no* | Hindsight Cloud API key (`hsk_…`) — enables the live memory backend |
| `HINDSIGHT_API_URL` | no | defaults to `https://api.hindsight.vectorize.io` |
| `HINDSIGHT_BANK_ID` | no | defaults to `sre-incidents` |
| `MEMORY_BACKEND` | no | `auto` (default) \| `hindsight` \| `fallback` |
| `LLM_BACKEND` | no | `auto` (default) \| `groq` \| `fallback` |
| `DEMO_FALLBACK` | no | `1` forces **both** local fallbacks (rehearsed-demo safety net) |

\* the app still boots and demos without them — it degrades to local fallbacks and shows
a calm status notice instead of hanging.

---

## How Hindsight memory is used

Hindsight is the app's **only** memory system when a key is configured — every
learn/recall goes through it (with no key, `backend/lib/fallback-memory.ts` implements the
same retain/recall contract locally):

### 1. `recall()` — on every new incident
`POST /api/suggest` runs `recall(bank, "<signature> <service> <error>")`
(`backend/lib/hindsight.ts → hindsightRecall`). Hindsight's recall returns past facts with
per-result similarity scores (`scores.semantic`, falling back to `scores.reranker` /
`scores.final`); they are normalized into past-incident records
(`backend/lib/memory.ts → mergeExperiences`, deduped by `recordId`).

### 2. Application-side ranking — **not the LLM**
The LLM never ranks anything. `backend/lib/scoring.ts` computes, per recalled incident:

```
score = 0.55 · semantic        ← similarity returned by Hindsight recall
      + 0.30 · success         ← own outcome + resolution-approach aggregate
      + 0.15 · recency         ← 0.5^(ageDays/45): old incidents decay, never vanish
```

* **semantic** — Hindsight `scores.semantic` (0–1 cosine) from the recall response.
* **success** — outcome-aware per candidate, **not** shared across the signature:
  `0.35 · ownOutcome + 0.65 · Laplace(successes, attempts)` over records sharing the
  candidate's **resolution approach** (`resolutionApproach` label — how the record fixed
  the problem). A failure (own outcome `false`) is capped at `0.65 · aggregate`, while a
  success gets `0.35 + 0.65 · aggregate` — so on this component a failed fix always loses
  to a successful record with the same aggregate, and in the demo corpus every failure
  ranks below every success. Thin groups are topped up with targeted probe recalls;
  Laplace smoothing keeps 0/1 samples honest.
  (The `chosen` slot is *not* a success-filtered pick — it is simply the top-ranked
  candidate, `candidates[0]` in `frontend/app/api/suggest/route.ts`. The Groq prompt is
  what directs the model to ground its steps in the highest-ranked **successful**
  candidate.)
* **recency** — 45-day half-life boost; older candidates rank lower but are never excluded.

Candidates are sorted by `score` and handed to Groq **already ranked**. The UI shows the
full component breakdown per candidate (`frontend/components/PastIncidents.tsx`).

### 3. Groq — phrasing only
`backend/lib/groq.ts` sends the incident + the ranked candidate table to Groq with instructions to
ground the steps in the highest-ranked **successful** candidate, cite candidates by number
and date, and call out failed approaches. It returns strict JSON
(`steps`, `reasoning`, `confidence`). It is never asked to invent or re-rank anything.

Confidence is calibrated before shipping: without memory it is capped at 0.4, and with
memory it cannot exceed 0.88 unless some recalled resolution is at most 3 days old —
stale evidence never justifies near-certainty, while a same-day prior resolution of the
same incident legitimately can.

### 4. `retain()` — on every feedback event
`POST /api/feedback` retains the full experience (`backend/lib/records.ts → buildExperienceRecord`):

* **“This fixed it”** → retained with `success=true`
* **“This did not help”** → retained with `success=false` — kept on purpose so the fix's
  future success rate goes **down** instead of being discarded

The record contains incident + suggestion + root cause + resolution approach + resolution
steps + time-to-resolve + outcome, as structured `Field: value` content plus metadata
(`recordId`, `errorSignature`, `success`, …). The live record carries the **same
`resolutionApproach` label as the fix the agent suggested**, so this outcome lands in that
approach's aggregate — which is exactly what moves the rated fix's success value on the
reveal panel after feedback.

### How the agent improves over time

1. **Report** an incident → recall → ranked candidates → Groq phrasing.
2. **Feedback** → `retain()` writes the outcome into Hindsight.
3. **Next similar report** → recall finds that record → its approach's aggregate now
   includes your outcome → ranking shifts → the suggestion (and the visible score table)
   reflects what your team actually learned.

Negative feedback teaches just as much: a fix that failed lowers its approach's rate, so
the agent stops recommending it and says so explicitly.

---

## Demo instructions (judging)

<!-- TODO: add demo video link here once recorded — do not invent a URL -->

### Seed data — required before the live demo

```bash
npm run seed                      # auto-detects backend (Hindsight if keyed, else local)
npm run seed -- --backend=hindsight
npm run seed -- --backend=fallback
npm run seed -- --force           # reset local store / re-retain into Hindsight
npm run seed -- --reset           # wipe the Hindsight bank + local incident store, reseed 15 fresh
```

Seeds **15 synthetic past incidents** across varied services and error types
(postgres deadlock, Kafka OOM, ENOSPC, TLS expiry, DNS timeout, nginx 502, …) including
**3 near-duplicate “Redis connection timeout” scenarios** with different resolutions and
different stored success rates — so live recall visibly **chooses among candidates**:

| Variant | Signature | History | Signature rate |
| --- | --- | --- | --- |
| A | `checkout-api:redis-connection-timeout` | 4 records (3 fixed, 1 restart-only failure) | 0.67 |
| B | `payments-api:redis-connection-timeout` | 3 records (1 fixed, 2 failures) | 0.40 |
| C | `search-api:redis-timeout-under-load` | 2 records (both fixed) | 0.75 |

Each record also carries its own `resolutionApproach` label — ranking blends the record's
**own outcome** with the aggregate over that approach's group, so failures sink below
successful fixes even when their text matches just as well.

The local fallback store auto-seeds on first use, so `npm run seed` matters most for
Hindsight Cloud.

### The with/without-memory comparison (the key demo)

1. Open the dashboard → click **“Prefill demo”** on the report form → **Report incident**.
2. The detail page auto-runs **With memory**: ranked candidates, score breakdown, a
   suggestion grounded in a specific past incident (date, root cause, TTR, success rate),
   with reasoning that cites `#1`, `#2`, … and explicitly rejects the failed restart-only
   approach.
3. Flip the **“Without memory”** toggle: *same incident, same Groq call* — recall is
   skipped and Groq receives empty context, so the answer collapses to generic
   first-principles advice with low confidence and zero references to your history.
4. Flip back — the difference is the product.
5. Submit **“This fixed it”** (optionally adding root cause + time-to-resolve) → the
   experience is `retain()`ed, the signature's stats update live
   (`checkout-api:… → n/n successful`), the **Memory** page shows the bank growing, and
   the **ranking-shift reveal** shows the rated fix's success value before → after
   (**0.78 → 0.84** on a freshly seeded bank), the just-retained record entering the
   ranking (`New entry ranks #1`), and a plain-language statement of whether the order
   changed. Re-ratings on the same approach shrink that step (Laplace converges — a
   second click on a 2/2 group moves only ~0.03), so run `npm run seed -- --reset`
   before the demo; `npm run smoke` asserts the ≥0.05 move on a fresh bank.
6. Report the same incident again → the just-retained entry is ranked **#1**, confidence
   is **higher** than the first run, and the reasoning cites the previous success **by
   date**.

### Reliability / fallback (demo safety net)

* Every Groq and Hindsight call is wrapped in try/catch; failures render a calm, visible
  notice (`backends.note`) — the demo screen never hangs blank.
* If Groq is missing/rate-limited → deterministic local generator
  (`backend/lib/demo-fallback.ts`) that still cites the ranked candidates (with an exact
  pre-written response for the rehearsed Redis scenario).
* If Hindsight is missing/slow → local fallback memory backend with the same corpus and
  contract (`backend/lib/fallback-memory.ts`).
* Force everything offline with `DEMO_FALLBACK=1`.
* The header always shows the active backends (`Hindsight live` / `fallback memory`) so
  the judge always knows how an answer was produced.

---

## Project structure

```
/
├── frontend/
│   ├── app/                        # Next.js App Router and API route entrypoints
│   │   ├── page.tsx                # Dashboard — report incident + stats + history
│   │   ├── memory/page.tsx         # Memory view — what the agent remembers
│   │   ├── incident/[id]/page.tsx  # Incident detail + agent suggestion + toggle
│   │   └── api/                    # Thin Next.js HTTP route boundary
│   ├── components/                 # UI components and shadcn/ui primitives
│   ├── lib/utils.ts                # Client-safe class-name utility
│   ├── public/                     # Static assets
│   ├── next.config.ts              # Next.js app configuration
│   ├── .env.local                  # canonical env keys (gitignored; copy of .env.example)
│   └── tsconfig.json               # Frontend aliases, including @backend/*
├── backend/
│   ├── lib/                        # Memory, scoring, LLM, persistence, and types
│   │   ├── hindsight.ts            # Hindsight client wrapper (retain/recall)
│   │   ├── memory.ts               # backend selection, parsing, recall→rank pipeline
│   │   ├── scoring.ts              # weighted ranking formula (pure functions)
│   │   ├── groq.ts                 # Groq call + prompts + JSON parsing
│   │   ├── demo-fallback.ts         # canned suggestions (offline safety net)
│   │   ├── records.ts               # retain-content builders + structured text parser
│   │   ├── fallback-memory.ts       # local fallback memory backend
│   │   ├── incident-store.ts        # local transactional incident log
│   │   ├── seed-data.ts              # 15-incident demo corpus
│   │   └── status.ts · env.ts · types.ts
│   ├── scripts/
│   │   ├── seed-hindsight.ts        # one-command demo seeding
│   │   └── smoke.mjs                # browser end-to-end test + screenshots
│   └── tsconfig.json                # Backend type-checking configuration
├── .env.example
└── README.md
```

> **Note:** `.data/incidents.json` is the app's transactional log of *this session's*
> reported incidents (what was shown, what the user rated). It is not the agent's memory —
> all learning and recall goes through Hindsight `retain()` / `recall()`.
> `.data/fallback-memory.json` is the local fallback memory store, used only when no
> Hindsight key reaches the app (it auto-seeds with the same 15 records).

## Commands

```bash
npm run dev         # start dev server (http://localhost:3000)
npm run build       # production build
npm run start       # serve production build (port 3000)
npm run start:3100  # serve production build on port 3100 (smoke's default base)
npm run lint        # eslint
npm run typecheck   # tsc --noEmit, once per tsconfig (frontend + backend)
npm run verify      # typecheck + lint + build — the pre-demo gate
npm run seed        # seed demo memory (see flags above)

# Browser end-to-end test (Playwright + Chrome, writes screenshots to /tmp/aira-shots).
# Default base URL is http://localhost:3100 — build and start first:
npm run build && npm run start:3100
npm run smoke
# …or point it at a running dev server:
SMOKE_BASE=http://localhost:3000 npm run smoke
```

> **Note:** if you prefer plain `npm run start`, the port flag needs the npm separator —
> `npm run start -- -p 3100`. Without `--` npm swallows `-p`, the server binds port 3000
> instead, and the smoke test cannot reach it. `npm run start:3100` avoids that footgun.

> **Note:** stop `npm run dev` before `npm run build` (or `npm run verify`, which builds).
> Both use the same `.next` directory, and building under a live dev server corrupts its
> cache — pages start returning 500 until the dev server is restarted.
