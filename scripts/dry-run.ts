/**
 * End-to-end dry run: live FPL data -> projections -> optimal XI -> the exact
 * prompt that would be sent to Claude. Everything but the API call.
 */
import { resolveSquad } from "../lib/squad/resolve";
import { buildAnalysisPrompt, ANALYST_SYSTEM_PROMPT } from "../lib/ai/prompts";
import { getBootstrap } from "../lib/fpl/client";

async function main() {
  const bootstrap = await getBootstrap();

  // Build a legal 15 (2 GKP, 5 DEF, 5 MID, 3 FWD) from the most-owned players,
  // which approximates a real template squad.
  const owned = (t: number) =>
    bootstrap.elements
      .filter((e) => e.element_type === t && e.status === "a")
      .sort((a, b) => parseFloat(b.selected_by_percent) - parseFloat(a.selected_by_percent));

  const playerIds = [
    ...owned(1).slice(0, 2),
    ...owned(2).slice(0, 5),
    ...owned(3).slice(0, 5),
    ...owned(4).slice(0, 3),
  ].map((e) => e.id);

  console.log("Template squad:", playerIds.length, "players\n");

  const resolved = await resolveSquad({ playerIds });

  console.log(`GW${resolved.gameweek}, horizon ${resolved.horizon}`);
  console.log(`Optimal XI: ${resolved.optimal.formationLabel} — ${resolved.optimal.expectedPoints.toFixed(1)} xPts\n`);
  console.log("STARTING XI");
  for (const p of resolved.optimal.startingXI) {
    console.log(`  ${p.position} ${p.webName.padEnd(15)} ${p.team.padEnd(4)} ${p.nextGameweekPoints.toFixed(2).padStart(5)} xPts`);
  }
  console.log("BENCH");
  for (const p of resolved.optimal.bench) {
    console.log(`  ${p.position} ${p.webName.padEnd(15)} ${p.team.padEnd(4)} ${p.nextGameweekPoints.toFixed(2).padStart(5)} xPts`);
  }
  console.log(`\nTransfer targets offered: ${resolved.transferTargets.length}`);

  const prompt = buildAnalysisPrompt({
    gameweek: resolved.gameweek,
    horizon: resolved.horizon,
    managerName: resolved.managerName,
    teamName: resolved.teamName,
    bank: resolved.bank,
    squad: resolved.squad,
    optimal: resolved.optimal,
    transferTargets: resolved.transferTargets,
  });

  const chars = ANALYST_SYSTEM_PROMPT.length + prompt.length;
  console.log(`\nPrompt size: ~${Math.round(chars / 4)} tokens (${chars} chars)`);
  console.log("\n=== USER PROMPT (first 2200 chars) ===\n");
  console.log(prompt.slice(0, 2200));
}

main().catch((e) => { console.error(e); process.exit(1); });
