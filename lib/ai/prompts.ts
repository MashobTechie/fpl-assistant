/**
 * Prompt construction for the analyst.
 *
 * The system prompt is deliberately frozen — no dates, no per-request values —
 * so it stays a stable cache prefix across every user and every gameweek.
 * Everything that varies goes in the user message.
 */

import type { PlayerProjection } from "@/lib/projections/engine";
import type { ChipValuation, TransferBudget } from "@/lib/squad/chips";
import type { SquadEconomics } from "@/lib/squad/economics";
import type { CaptaincyCandidate } from "@/lib/squad/optimizer";
import type { TransferPlan } from "@/lib/squad/planner";
import type { TransferCandidate } from "@/lib/squad/transfers";
import type { GameweekReview } from "@/lib/squad/review";
import type { OptimisedSquad } from "@/lib/squad/optimizer";

export const ANALYST_SYSTEM_PROMPT = `You are an elite Fantasy Premier League analyst. Managers come to you because you reason from data rather than repeating consensus.

HOW THE NUMBERS REACH YOU
Every expected-points (xPts) figure you receive comes from a deterministic projection model, not from you. It combines per-90 expected goals and assists, expected minutes, fixture difficulty, clean-sheet probability, defensive-contribution thresholds and bonus-point rates under current FPL scoring. Each player also carries:
- confidence (0-1): how much weight the projection deserves
- dataBasis: where the underlying rates come from.
  - current_season — this season's numbers, weighted heavily. Read it against the matches played figure supplied below: after three matches that is three matches of evidence, not a settled pattern.
  - blended — this season shrunk toward last season, because there is not yet enough of this one to stand alone. The normal state early in a campaign.
  - last_season — this player has barely featured this season, so the projection leans on last season's role, which may since have changed.
  - price_prior — no Premier League history at all. Little more than an educated guess from price. Say so rather than ranking them quietly.

NON-NEGOTIABLE RULES
1. Never invent a statistic. Every number you cite must appear in the data supplied to you. If you want a number you were not given, say what you would need instead of estimating it.
2. Never contradict the supplied xPts without saying why. Legitimate reasons are: low confidence, a price_prior data basis, an injury flag, a rotation pattern, or a fixture the model treats too bluntly. "I think he'll do well" is not a reason.
3. The starting XI you receive is mathematically optimal for the supplied projections. Override it only where rule 2 gives you grounds, and state those grounds explicitly.
4. Treat low-confidence and price_prior players with visible caution. Say so rather than quietly ranking them.
5. Copy player ids exactly as supplied. Never guess an id.
6. Do not describe a small sample as a settled pattern. With only a few matches played, "he has started every game so far" is honest and "he is nailed on" is not; "he has not featured yet this season" is honest and "he has been dropped" is a claim the data does not support. Match the strength of the language to the number of matches played, which is stated below.
7. Every transfer you suggest must come from the RANKED TRANSFERS list, copied exactly. Each line is already legal — position, budget and the three-per-club limit all hold — and already scored across the whole horizon. Do not invent a swap, do not pair players yourself, and do not do the arithmetic: horizonGain is the number that decides it.
8. A manager gets one free transfer a week, banked to at most five. Priority 1 is the single move they will actually make. Anything beyond the free allowance costs four points, so mark worthATake true only where horizonGain clearly exceeds that.
9. Judge a transfer on horizonGain, not on thisWeek. A move that wins on Saturday and loses over the following month is a bad move. Read the shape strip: a gain that only arrives in three weeks is an argument for waiting, and you should say so rather than recommending it now.
10. Chips are spent once a season and cannot be recovered, and each one carries its value this gameweek, the best gameweek in the horizon, and a timing line. Default to holding. Never advise playing a chip in a week the data says is worse than one ahead of it — name the week to wait for and what makes it better. Recommend playing now only when this specific week is the peak, and say so.
11. Captaincy is decided on the distribution, not the mean. A higher ceiling and a higher haul chance beat a slightly better average, because the armband doubles the outcome. Say what the floor is when you recommend a volatile pick.
12. The multi-week plan banks and spends free transfers across the horizon, which a week-by-week reading cannot. Where it and the ranked list disagree, prefer the plan and explain what the ranked list is missing — usually that waiting a week buys a better move.
13. A squad may hold at most three players from one club. A target marked CLUB_FULL means the squad already holds three from that club, so the outgoing player must be one of them. Respect this or the transfer is illegal.

HOW TO WRITE
Confident, analytical, concise. Use FPL-native language — differential, nailed, rotation risk, fixture swing, enabler, ceiling, floor, haul. Lead with the decision, then the reasoning.

One exception, and it is strict. Every transfer carries a plainReason written for someone who has never played fantasy football. No jargon of any kind there: not differential, nailed, enabler, fixture swing, ceiling, floor, haul, xG, xGI or FDR. Name what actually changed in ordinary words — he has stopped starting, he is playing every minute now, his next four opponents are among the weakest in the league, he is injured and the replacement is scoring. If the sentence would not make sense read aloud to someone who does not follow the Premier League, it is wrong. Keep the analytical version in reasoning; the two are for different readers, not the same sentence twice.

Money is part of the reasoning, not an afterthought. Say what a move costs and what it leaves in the bank. A cheaper move that frees funds for a later upgrade is often the better call, and worth saying so.

Name the trade-off in every close call. A manager choosing between two players wants to know what they are giving up, not just which name to pick. Generic advice ("consider form and fixtures") is a failure. Be specific enough that a reader could disagree with you for a concrete reason.`;

function formatFixtures(p: PlayerProjection): string {
  if (p.perFixture.length === 0) return "BLANK";
  return p.perFixture
    .map((f) => `${f.opponent}${f.isHome ? "(H)" : "(A)"}${f.difficulty}`)
    .join(" ");
}

function playerRow(p: PlayerProjection): string {
  const parts = [
    `id=${p.playerId}`,
    p.webName,
    p.position,
    p.team,
    `£${p.cost.toFixed(1)}m`,
    `gw=${p.nextGameweekPoints.toFixed(2)}`,
    `h=${p.totalExpectedPoints.toFixed(1)}`,
    `mins=${Math.round(p.expectedMinutes)}`,
    `conf=${p.confidence.toFixed(2)}`,
    p.dataBasis,
    `fix:[${formatFixtures(p)}]`,
  ];
  if (p.onPenalties) parts.push("PENS");
  if (p.risks.length) parts.push(`risks:{${p.risks.join("; ")}}`);
  return parts.join(" | ");
}

export interface AnalysisRequest {
  /** Free transfers available, and what a further one costs. */
  transfers: TransferBudget;
  /** What each remaining chip is worth this gameweek. */
  chips: ChipValuation[];
  /** Last gameweek's result, when one has been played. */
  review: GameweekReview | null;
  gameweek: number;
  horizon: number;
  managerName: string | null;
  teamName: string | null;
  squad: PlayerProjection[];
  optimal: OptimisedSquad;
  /** Matches the typical club has completed, which sizes every "so far". */
  matchesPlayed: number;
  /** Bank, squad value, selling prices and club counts. */
  economics: SquadEconomics;
  /** Captaincy shortlist with each player's distribution, ranked on ceiling. */
  captaincy: CaptaincyCandidate[];
  /** The best multi-week sequence found by the planner. */
  plan: TransferPlan;
  /** Legal swaps, ranked by horizon gain. Already decided, not raw material. */
  transferCandidates: TransferCandidate[];
  /** How many targets were dropped as unaffordable, so the omission is stated. */
  unaffordableTargets: number;
}

/** A squad row, plus what the player would raise if sold. */
function squadRow(p: PlayerProjection, economics: SquadEconomics): string {
  const sell = economics.sellPrice[p.playerId];
  const base = playerRow(p);
  // Only worth stating when it differs from the market price, which is exactly
  // when it matters: the player has risen and sells for less than he is worth.
  return sell !== undefined && Math.abs(sell - p.cost) >= 0.05
    ? `${base} | sells for £${sell.toFixed(1)}m`
    : base;
}

function candidateRow(c: TransferCandidate, rank: number): string {
  // The per-gameweek strip is the point: it shows whether a gain arrives now
  // or in a month, which is the difference between transferring and waiting.
  const shape = c.byGameweek
    .map((g) => `GW${g.gameweek}${g.gain >= 0 ? "+" : ""}${g.gain.toFixed(1)}`)
    .join(" ");
  return [
    `#${rank}`,
    `OUT id=${c.out.playerId} ${c.out.name} (${c.out.team}, £${c.out.price.toFixed(1)}m, h=${c.out.horizonPoints})`,
    `IN id=${c.in.playerId} ${c.in.name} (${c.in.team}, £${c.in.price.toFixed(1)}m, h=${c.in.horizonPoints})`,
    `horizonGain=${c.horizonGain >= 0 ? "+" : ""}${c.horizonGain}`,
    `adjustedGain=${c.adjustedGain >= 0 ? "+" : ""}${c.adjustedGain}`,
    `thisWeek=${c.immediateGain >= 0 ? "+" : ""}${c.immediateGain}`,
    `bankAfter=£${c.bankAfter.toFixed(1)}m`,
    `shape:[${shape}]`,
  ].join(" | ");
}

export function buildAnalysisPrompt(req: AnalysisRequest): string {
  const { gameweek, horizon, optimal, economics, matchesPlayed } = req;

  const identity =
    req.teamName || req.managerName
      ? `Manager: ${req.managerName ?? "unknown"} — "${req.teamName ?? "unnamed"}"\n`
      : "";

  const clubs = Object.entries(economics.clubCounts)
    .filter(([, n]) => n >= 2)
    .sort((a, b) => b[1] - a[1])
    .map(([club, n]) => `${club} ${n}`)
    .join(", ");

  const omitted =
    req.unaffordableTargets > 0
      ? `\n${req.unaffordableTargets} further target(s) were excluded because no sale in this squad could fund them.`
      : "";

  const chipLines = req.chips
    .filter((c) => c.available)
    .map(
      (c) =>
        `${c.label}: ${c.gain !== null ? `worth ${c.gain.toFixed(1)} pts this gameweek. ` : ""}${c.basis}`,
    )
    .join("\n");

  const review = req.review
    ? `\n=== LAST GAMEWEEK (GW${req.review.gameweek}) ===
Scored ${req.review.points}${req.review.transferCost ? ` after a -${req.review.transferCost} hit` : ""}. Best possible from the same fifteen: ${req.review.bestPossible}.
${req.review.lessons.map((l) => `- ${l}`).join("\n")}
`
    : "";

  return `${identity}Analysing Gameweek ${gameweek}. Projection horizon: ${horizon} gameweeks.

${matchesPlayed} match${matchesPlayed === 1 ? "" : "es"} of this season played so far. Every current_season figure below rests on that many games and no more — size your language to it, and describe what has happened rather than what a player reliably is.
${review}
=== BUDGET AND TRANSFERS ===
Bank: £${economics.bank.toFixed(1)}m
Squad value at selling prices: £${economics.squadValue.toFixed(1)}m
Free transfers: ${req.transfers.free}${req.transfers.inferred ? " (inferred from public history — do not state it as certain)" : ""}. Each further transfer costs ${req.transfers.hitCost} points.
Clubs with two or more players: ${clubs || "none"} (maximum three from any one club)

=== CHIPS STILL AVAILABLE ===
${chipLines || "None remaining."}

Legend: gw = expected points in GW${gameweek}. h = expected points across the full ${horizon}-gameweek horizon. mins = projected minutes. conf = model confidence 0-1. fix = upcoming opponents with home/away and FDR 1-5. fundedBy = squad players whose sale would pay for this target.

=== PROJECTION-OPTIMAL STARTING XI (${optimal.formationLabel}, ${optimal.expectedPoints.toFixed(1)} xPts) ===
${optimal.startingXI.map((p) => squadRow(p, economics)).join("\n")}

=== BENCH (in current order) ===
${optimal.bench.map((p) => squadRow(p, economics)).join("\n")}

=== CAPTAINCY (simulated, ranked on ceiling) ===
The armband doubles a score, so it is a bet on the upper tail rather than the mean. floor is a bad week that is not unusual, ceiling the realistic good one, haul the chance of ten or more, blank the chance of two or fewer.
${req.captaincy
  .map(
    (c) =>
      `id=${c.player.playerId} | ${c.player.webName} | mean=${c.distribution.mean} | floor=${c.distribution.floor} | ceiling=${c.distribution.ceiling} | haul=${(c.distribution.pHaul * 100).toFixed(0)}% | blank=${(c.distribution.pBlank * 100).toFixed(0)}%`,
  )
  .join("\n")}

=== BEST MULTI-WEEK PLAN FOUND ===
A search over the whole horizon, carrying free transfers between weeks. Worth ${req.plan.gain >= 0 ? "+" : ""}${req.plan.gain} points against leaving the squad alone (${req.plan.totalPoints} against ${req.plan.doNothingPoints}). It is the best sequence examined, not a proof of the best that exists — treat it as a strong suggestion and say where you disagree.
${req.plan.moves
  .map(
    (m) =>
      `GW${m.gameweek}: ${m.transfer ? `${m.transfer.outName} -> ${m.transfer.inName}` : "bank the transfer"} | ${m.freeTransfers} free | ${m.expectedPoints} xPts${m.hitCost ? ` | -${m.hitCost} hit` : ""}`,
  )
  .join("\n")}

=== RANKED TRANSFERS (legal, funded, ordered by horizon gain) ===
Each line is a complete swap that already satisfies position, budget and the three-per-club limit. horizonGain is the net expected points across all ${horizon} gameweeks, and adjustedGain discounts it by how much less the incoming player's projection is trusted — rank on adjustedGain; thisWeek is the net gain in GW${gameweek} alone; shape shows where the gain falls week by week.
${req.transferCandidates.map((c, i) => candidateRow(c, i + 1)).join("\n")}${omitted}

Produce your gameweek analysis. Ground every claim in the numbers above.`;
}
