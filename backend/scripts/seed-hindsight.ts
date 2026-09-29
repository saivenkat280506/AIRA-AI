#!/usr/bin/env tsx
/**
 * Seed the demo corpus into the active memory backend.
 *
 *   npm run seed                     → seed Hindsight Cloud (or local fallback)
 *   npm run seed -- --backend=hindsight
 *   npm run seed -- --backend=fallback
 *   npm run seed -- --force          → reset local store / re-retain into Hindsight
 *   npm run seed -- --reset          → delete the Hindsight bank, clear the local
 *                                      incident store (counter → 0), reseed 15 fresh
 *
 * Seeds 15 synthetic past incidents, including 3 near-duplicate
 * "Redis connection timeout" variants with different resolutions and stored
 * success rates (checkout-api 3/4, payments-api 1/3, search-api 2/2) so a live
 * demo visibly shows the agent CHOOSE among ranked candidates.
 */
import { promises as fs } from "node:fs";
import path from "node:path";

/**
 * Load env for the seed script (tsx does not load Next.js env files).
 *
 * Canonical location is `frontend/.env.local` — the same file Next.js reads,
 * so the app and this script always see identical keys. Repo-root `.env*`
 * files are still honored as a legacy fallback (with a warning), because a
 * root-only file leaves the running app in fallback mode.
 *
 * First file to define a key wins; already-exported shell vars win over both.
 */
async function loadEnvFiles(): Promise<string[]> {
  const canonical = ["frontend/.env.local", "frontend/.env"];
  const legacy = [".env.local", ".env"];
  const legacyUsed: string[] = [];

  for (const [index, file] of [...canonical, ...legacy].entries()) {
    try {
      const raw = await fs.readFile(path.join(process.cwd(), file), "utf8");
      if (index >= canonical.length) legacyUsed.push(file);
      for (const line of raw.split("\n")) {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith("#")) continue;
        const eq = trimmed.indexOf("=");
        if (eq < 0) continue;
        const key = trimmed.slice(0, eq).trim();
        let value = trimmed.slice(eq + 1).trim();
        if (
          (value.startsWith('"') && value.endsWith('"')) ||
          (value.startsWith("'") && value.endsWith("'"))
        ) {
          value = value.slice(1, -1);
        }
        if (!(key in process.env)) process.env[key] = value;
      }
    } catch {
      /* file absent — fine */
    }
  }
  return legacyUsed;
}

async function main(): Promise<void> {
  const legacyEnvFiles = await loadEnvFiles();

  const args = process.argv.slice(2);
  const force = args.includes("--force");
  const reset = args.includes("--reset");
  const backendArg = args.find((a) => a.startsWith("--backend="))?.split("=")[1];
  if (backendArg === "hindsight" || backendArg === "fallback") {
    process.env.MEMORY_BACKEND = backendArg;
  }

  const { getMemoryBackend, markHindsightSeeded } = await import("../lib/memory");
  const { buildSeedRecords } = await import("../lib/records");
  const { fallbackCount, fallbackReset } = await import("../lib/fallback-memory");

  const backend = getMemoryBackend();
  console.log(`\nAIRA seed script`);
  console.log(`  backend: ${backend.name} — ${backend.detail}`);
  if (legacyEnvFiles.length) {
    console.log(
      `  ⚠ env read from legacy ${legacyEnvFiles.join(" + ")} — move it to ` +
        `frontend/.env.local (canonical; Next.js only reads there) so the app sees the same keys.`,
    );
  }
  console.log("");

  // ── Hindsight: optional full wipe of the bank before seeding.
  //    Also clears the local incident store so the demo starts with
  //    "learned today" at 0 and an empty Recent-incidents list.
  if (reset) {
    if (backend.name !== "hindsight") {
      console.log("--reset only applies to the Hindsight backend; skipping.\n");
    } else {
      const { getHindsightClient } = await import("../lib/hindsight");
      try {
        await getHindsightClient().deleteBank(process.env.HINDSIGHT_BANK_ID || "sre-incidents");
        console.log("  Deleted bank — it will be recreated on first retain.\n");
      } catch (err) {
        console.log(`  Bank delete skipped: ${err instanceof Error ? err.message : err}\n`);
      }
    }
    try {
      await fs.rm(path.join(process.cwd(), ".data", "incidents.json"), { force: true });
      console.log("  Cleared local incident store — learned-today counter back to 0.\n");
    } catch {
      /* no store yet — fine */
    }
  }

  // ── Local fallback: the store auto-seeds from lib/seed-data.ts on first read.
  if (backend.name === "fallback") {
    if (force) await fallbackReset();
    const count = await fallbackCount(); // triggers auto-seed when empty
    console.log(`✔ Local fallback store ready with ${count} incident records.`);
    console.log(`  (stored at .data/fallback-memory.json)\n`);
    return;
  }

  // ── Hindsight Cloud: retain each incident, idempotent via a recall probe.
  const records = buildSeedRecords();
  if (!force) {
    const probe = await backend.recall("seed-01 past production incident record", {
      maxTokens: 2000,
      limit: 10,
    });
    const alreadySeeded = probe.some((f) => {
      const id = f.metadata?.recordId ?? f.context?.replace(/^incident-record:/, "");
      return (id ?? "").startsWith("seed-");
    });
    if (alreadySeeded) {
      await markHindsightSeeded(records.length);
      console.log("✔ Seed corpus already present in this bank — nothing to do.");
      console.log("  Re-run with --force to retain it again (creates duplicates).\n");
      return;
    }
  }

  console.log(`Retaining ${records.length} incidents into bank “${backend.detail}”…`);
  for (const [i, record] of records.entries()) {
    const label = `${i + 1}/${records.length} ${record.recordId}`;
    try {
      await backend.retain([record]);
      console.log(`  ✔ ${label}`);
    } catch (err) {
      console.error(`  ✖ ${label} — ${err instanceof Error ? err.message : err}`);
      throw new Error("Seeding failed partway; fix the error above and re-run.");
    }
  }

  await markHindsightSeeded(records.length);
  console.log(`\n✔ Seeded ${records.length} incidents into ${backend.name}.`);
  console.log(`  Bank: ${process.env.HINDSIGHT_BANK_ID || "sre-incidents"}`);
  console.log(`  Demo scenario: report a Redis connection timeout on checkout-api.\n`);
}

main().catch((err) => {
  console.error("\nSeed failed:", err instanceof Error ? err.message : err);
  process.exit(1);
});
