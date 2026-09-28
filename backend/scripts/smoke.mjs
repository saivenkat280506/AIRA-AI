/* Browser smoke test for AIRA: full demo flow + screenshots.
 *
 * Verifies the learning story end-to-end:
 *   dashboard → side-by-side comparison → feedback → ranking-shift reveal
 *   → live counter → memory page "Just learned" → mobile toggle.
 *
 * Run against a dev/prod server:  SMOKE_BASE=http://localhost:3000 npm run smoke
 */
import { chromium } from "playwright-core";
import fs from "node:fs";

const BASE = process.env.SMOKE_BASE ?? "http://localhost:3100";
const OUT = "/tmp/aira-shots";
fs.mkdirSync(OUT, { recursive: true });

const errors = [];
const browser = await chromium.launch({ channel: "chrome", headless: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 960 } });
page.on("console", (m) => {
  if (m.type() === "error") errors.push(`console: ${m.text()}`);
});
page.on("pageerror", (e) => errors.push(`pageerror: ${e.message}`));

async function shot(name) {
  await page.screenshot({ path: `${OUT}/${name}.png`, fullPage: true });
  console.log(`  shot: ${name}`);
}

const visibleCount = (selector) =>
  page.locator(selector).evaluateAll((els) =>
    els.filter((e) => e.offsetParent !== null || e.getClientRects().length > 0).length,
  );

try {
  // 1) Dashboard — stats include the live "Learned today" counter
  await page.goto(BASE, { waitUntil: "networkidle" });
  await page.waitForSelector("text=Fix incidents with memory");
  await page.waitForSelector("text=Learned today", { timeout: 10000 });
  await shot("01-dashboard");

  // 2) Prefill + submit demo incident
  await page.click("text=Prefill demo");
  await page.waitForTimeout(300);
  await page.click('button:has-text("Report incident")');
  await page.waitForURL("**/incident/**", { timeout: 15000 });
  const incidentUrl = page.url();
  console.log("  incident page:", incidentUrl);

  // 3) BOTH answers arrive side by side (parallel fetches)
  await page.waitForSelector('[data-testid="suggestion-without"]', {
    state: "visible",
    timeout: 40000,
  });
  await page.waitForSelector('[data-testid="suggestion-with"]', {
    state: "visible",
    timeout: 40000,
  });
  await page.waitForSelector("text=Memory skipped", { state: "visible", timeout: 40000 });
  await page.waitForSelector("text=chosen", { state: "visible", timeout: 40000 });
  await page.waitForSelector("text=Suggested resolution steps", {
    state: "visible",
    timeout: 40000,
  });
  await page.waitForTimeout(600);

  const stepBlocks = await visibleCount("text=Suggested resolution steps");
  console.log("  visible 'Suggested resolution steps' blocks (expect 2):", stepBlocks);
  const reasoning = await page
    .locator('[data-testid="suggestion-with"] blockquote')
    .first()
    .textContent();
  console.log("  with-memory reasoning:", (reasoning ?? "").slice(0, 140));
  await shot("02-side-by-side");

  // 4) Feedback → learned card → ranking-shift reveal
  await page.fill('input[id="root-cause"]', "Redis pool exhaustion confirmed in browser test");
  await page.fill('input[id="ttr"]', "30 minutes");
  await page.click('button:has-text("This fixed it")');
  await page.waitForSelector("text=experience retained in memory", {
    state: "visible",
    timeout: 30000,
  });
  console.log("  feedback learned card shown");

  await page.waitForSelector("text=Ranking recomputed after retain()", {
    state: "visible",
    timeout: 45000,
  });
  await page.waitForSelector("text=Success-rate component", { state: "visible", timeout: 10000 });
  await page.waitForSelector("text=/The order (changed|did not change)/", {
    state: "visible",
    timeout: 10000,
  });
  await page.waitForSelector("text=New entry ranks", { state: "visible", timeout: 10000 });
  const shiftText = await page
    .locator("text=/The order (changed|did not change)/")
    .first()
    .textContent();
  console.log("  order statement:", (shiftText ?? "").trim());
  const entryText = await page
    .locator("text=New entry ranks")
    .first()
    .textContent();
  console.log("  new entry:", (entryText ?? "").trim());

  // Requirement: one click must move the rated success value by >= 0.05.
  const rateHint = await page
    .locator("text=/after your feedback/")
    .first()
    .textContent()
    .catch(() => null);
  const deltaMatch = (rateHint ?? "").match(/([+-]?\d+\.\d+)\s*after your feedback/);
  if (deltaMatch) {
    const delta = Math.abs(parseFloat(deltaMatch[1]));
    console.log("  success-rate delta:", delta.toFixed(2));
    if (delta < 0.05) errors.push(`success-rate delta ${delta} < 0.05`);
  } else {
    errors.push(`could not parse success-rate delta from: ${rateHint}`);
  }
  await page.waitForTimeout(900); // let the count-up settle
  await shot("03-ranking-shift");

  // 5) Header counter ticked
  const headerCount = await page
    .locator("text=/learned today/")
    .first()
    .textContent()
    .catch(() => null);
  console.log("  header counter:", (headerCount ?? "").trim());

  // 6) Memory page — fresh entry at top with the Just learned badge
  await page.goto(`${BASE}/memory`, { waitUntil: "networkidle" });
  await page.waitForSelector("text=What the agent remembers", { timeout: 20000 });
  await page.waitForSelector("text=Just learned", { state: "visible", timeout: 20000 });
  await page.waitForTimeout(800);
  await shot("04-memory-just-learned");

  // 7) Dashboard counter after the round trip
  await page.goto(BASE, { waitUntil: "networkidle" });
  await page.waitForSelector("text=Learned today", { timeout: 10000 });
  await page.waitForTimeout(400);
  await shot("05-dashboard-learned");

  // 8) Mobile: toggle collapses the split to one visible column
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(BASE, { waitUntil: "networkidle" });
  await shot("06-dashboard-mobile");

  await page.goto(incidentUrl, { waitUntil: "networkidle" });
  await page.waitForSelector("text=Response mode", { state: "visible", timeout: 30000 });
  await page.waitForSelector('button:has-text("Without memory")', {
    state: "visible",
    timeout: 30000,
  });
  await page.click('button:has-text("Without memory")');
  // Scope to the visible column — the desktop split still exists in the DOM at 390px.
  const visibleWithout = page.locator('[data-testid="suggestion-without"]:visible');
  await visibleWithout.waitFor({ state: "visible", timeout: 20000 });
  await visibleWithout
    .locator("text=Memory skipped")
    .first()
    .waitFor({ state: "visible", timeout: 20000 });
  await page.waitForTimeout(400);
  await shot("07-incident-mobile-toggle");

  console.log("\nRESULT:", errors.length === 0 ? "NO PAGE ERRORS" : "ERRORS:");
  for (const e of errors) console.log("  ", e);
  if (errors.length > 0) process.exitCode = 1;
} catch (err) {
  console.error("SMOKE TEST FAILED:", err.message);
  await shot("99-failure").catch(() => {});
  for (const e of errors) console.log("  ", e);
  process.exitCode = 1;
} finally {
  await browser.close();
}
