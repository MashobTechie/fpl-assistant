/**
 * Sanity-checks the projection engine against real FPL data.
 * Run: npx tsx scripts/validate-projections.ts <bootstrap.json> <fixtures.json>
 */
import fs from "node:fs";
import { buildContext, projectMany } from "../lib/projections/engine";
import type { FplBootstrap, FplFixture } from "../lib/fpl/types";

const [bootstrapPath, fixturesPath] = process.argv.slice(2);
const bootstrap: FplBootstrap = JSON.parse(fs.readFileSync(bootstrapPath, "utf8"));
const fixtures: FplFixture[] = JSON.parse(fs.readFileSync(fixturesPath, "utf8"));

const ctx = buildContext(bootstrap, fixtures);
const gw = bootstrap.events.find((e) => e.is_next)?.id ?? 1;
console.log(`Target GW ${gw} | completed GWs: ${ctx.completedGameweeks}\n`);

const projections = projectMany(bootstrap.elements, ctx, gw, 5);

const fmt = (p: (typeof projections)[number]) =>
  `${p.webName.padEnd(15)} ${p.position} ${p.team.padEnd(4)} £${p.cost.toFixed(1).padStart(4)}m  ` +
  `GW${gw}=${p.nextGameweekPoints.toFixed(2).padStart(5)}  5GW=${p.totalExpectedPoints.toFixed(1).padStart(5)}  ` +
  `mins=${p.expectedMinutes.toFixed(0).padStart(2)} conf=${p.confidence.toFixed(2)} ${p.dataBasis}`;

console.log("=== TOP 15 by GW" + gw + " expected points ===");
[...projections].sort((a, b) => b.nextGameweekPoints - a.nextGameweekPoints).slice(0, 15).forEach((p) => console.log("  " + fmt(p)));

console.log("\n=== TOP 8 by position over 5 GWs ===");
for (const pos of ["GKP", "DEF", "MID", "FWD"] as const) {
  console.log(` -- ${pos} --`);
  projections.filter((p) => p.position === pos)
    .sort((a, b) => b.totalExpectedPoints - a.totalExpectedPoints)
    .slice(0, 5).forEach((p) => console.log("   " + fmt(p)));
}

console.log("\n=== SANITY CHECKS ===");
const played = projections.filter((p) => p.expectedMinutes > 45);
const avg = played.reduce((s, p) => s + p.nextGameweekPoints, 0) / played.length;
console.log(`  regular starters (>45 xmins): ${played.length}`);
console.log(`  mean GW xPts among them:      ${avg.toFixed(2)}  (expect ~3-5)`);
const max = Math.max(...projections.map((p) => p.nextGameweekPoints));
console.log(`  highest single-GW xPts:       ${max.toFixed(2)}  (expect ~6-9)`);
const neg = projections.filter((p) => p.nextGameweekPoints < 0);
console.log(`  negative projections:         ${neg.length}  (expect 0)`);
const flagged = projections.filter((p) => p.status !== "a" && p.nextGameweekPoints > 3);
console.log(`  flagged players still >3 pts: ${flagged.length}  (expect 0)`);
const basis = projections.reduce<Record<string, number>>((acc, p) => { acc[p.dataBasis] = (acc[p.dataBasis] ?? 0) + 1; return acc; }, {});
console.log(`  data basis split:`, basis);

const haaland = projections.find((p) => p.webName === "Haaland");
if (haaland) {
  console.log(`\n  Haaland GW${gw} breakdown:`);
  const f = haaland.perFixture[0];
  if (f) {
    console.log(`    vs ${f.opponent} ${f.isHome ? "(H)" : "(A)"} FDR ${f.difficulty}, ${f.expectedMinutes.toFixed(0)} mins`);
    for (const [k, v] of Object.entries(f.breakdown)) console.log(`      ${k.padEnd(24)} ${v.toFixed(3)}`);
    console.log(`      ${"TOTAL".padEnd(24)} ${f.expectedPoints.toFixed(3)}`);
  }
}
