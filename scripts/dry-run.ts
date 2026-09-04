/**
 * End-to-end dry run: live FPL data -> projections -> optimal XI -> the exact
 * prompt that would be sent to Claude. Everything but the API call.
 */
import { resolveSquad } from "../lib/squad/resolve";
import { buildAnalysisPrompt, ANALYST_SYSTEM_PROMPT } from "../lib/ai/prompts";
import { getBootstrap } from "../lib/fpl/client";

async function main() {
  const bootstrap = await getBootstrap();

  // Build a genuinely legal 15: the right shape, at most three from any club,
  // and inside £100.0m. Filling the quotas by ownership alone is not enough —
  // the most-owned players cluster into the good teams and cost about £112m,
  // so tuning against that squad tunes against a team nobody can field.
  const QUOTA: Record<number, number> = { 1: 2, 2: 5, 3: 5, 4: 3 };
  const BUDGET = 1000; // tenths of a million, as FPL stores it
  const MAX_CLUB = 3;

  const pool = bootstrap.elements
    .filter((e) => e.status === "a")
    .sort(
      (a, b) =>
        parseFloat(b.selected_by_percent) - parseFloat(a.selected_by_percent),
    );

  const squad: typeof pool = [];
  const posCount: Record<number, number> = { 1: 0, 2: 0, 3: 0, 4: 0 };
  const clubCount = new Map<number, number>();

  const canAdd = (e: (typeof pool)[number]) =>
    posCount[e.element_type] < QUOTA[e.element_type] &&
    (clubCount.get(e.team) ?? 0) < MAX_CLUB &&
    !squad.some((x) => x.id === e.id);

  const add = (e: (typeof pool)[number]) => {
    squad.push(e);
    posCount[e.element_type]++;
    clubCount.set(e.team, (clubCount.get(e.team) ?? 0) + 1);
  };
  const drop = (e: (typeof pool)[number]) => {
    squad.splice(squad.indexOf(e), 1);
    posCount[e.element_type]--;
    clubCount.set(e.team, (clubCount.get(e.team) ?? 1) - 1);
  };

  for (const e of pool) if (canAdd(e)) add(e);

  // Downgrade the priciest player for the cheapest legal alternative until the
  // squad fits, which is what a real manager does when the sums do not work.
  const total = () => squad.reduce((sum, e) => sum + e.now_cost, 0);
  while (total() > BUDGET) {
    const dearest = [...squad].sort((a, b) => b.now_cost - a.now_cost)[0];
    drop(dearest);
    const replacement = pool
      .filter(
        (e) =>
          e.element_type === dearest.element_type &&
          e.now_cost < dearest.now_cost &&
          canAdd(e),
      )
      .sort((a, b) => a.now_cost - b.now_cost)[0];
    if (!replacement) {
      add(dearest); // nothing cheaper available; stop rather than loop forever
      break;
    }
    add(replacement);
  }

  const playerIds = squad.map((e) => e.id);
  console.log(
    `Template squad: ${playerIds.length} players, £${(total() / 10).toFixed(1)}m\n`,
  );

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
    economics: resolved.economics,
    unaffordableTargets: resolved.unaffordableTargets,
    transfers: resolved.transfers,
    chips: resolved.chips,
    review: resolved.review,
    squad: resolved.squad,
    optimal: resolved.optimal,
    transferCandidates: resolved.transferCandidates,
  });

  const chars = ANALYST_SYSTEM_PROMPT.length + prompt.length;
  console.log(`\nPrompt size: ~${Math.round(chars / 4)} tokens (${chars} chars)`);
  console.log("\n=== USER PROMPT (first 2200 chars) ===\n");
  console.log(prompt.slice(0, 2200));
}

main().catch((e) => { console.error(e); process.exit(1); });
