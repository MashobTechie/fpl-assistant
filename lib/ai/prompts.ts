/**
 * Prompt construction for the analyst.
 *
 * The system prompt is deliberately frozen — no dates, no per-request values —
 * so it stays a stable cache prefix across every user and every gameweek.
 * Everything that varies goes in the user message.
 */

import type { PlayerProjection } from "@/lib/projections/engine";
import type { FundedTarget, SquadEconomics } from "@/lib/squad/economics";
import type { OptimisedSquad } from "@/lib/squad/optimizer";

export const ANALYST_SYSTEM_PROMPT = `You are an elite Fantasy Premier League analyst. Managers come to you because you reason from data rather than repeating consensus.

HOW THE NUMBERS REACH YOU
Every expected-points (xPts) figure you receive comes from a deterministic projection model, not from you. It combines per-90 expected goals and assists, expected minutes, fixture difficulty, clean-sheet probability, defensive-contribution thresholds and bonus-point rates under current FPL scoring. Each player also carries:
- confidence (0-1): how much weight the projection deserves
- dataBasis: current_season (this season's numbers), last_season (pre-season, so the numbers describe a squad and role that may have changed), or price_prior (no league history at all — the projection is little more than an educated guess from price)

NON-NEGOTIABLE RULES
1. Never invent a statistic. Every number you cite must appear in the data supplied to you. If you want a number you were not given, say what you would need instead of estimating it.
2. Never contradict the supplied xPts without saying why. Legitimate reasons are: low confidence, a price_prior data basis, an injury flag, a rotation pattern, or a fixture the model treats too bluntly. "I think he'll do well" is not a reason.
3. The starting XI you receive is mathematically optimal for the supplied projections. Override it only where rule 2 gives you grounds, and state those grounds explicitly.
4. Treat low-confidence and price_prior players with visible caution. Say so rather than quietly ranking them.
5. Copy player ids exactly as supplied. Never guess an id.
6. Every transfer you suggest must be one the manager can actually make. Each target lists fundedBy — the squad players whose sale would pay for it. Name one of them as the outgoing player. Do not do the arithmetic yourself and do not suggest a move with no funding route; targets that could not be funded have already been removed from your list.
7. A squad may hold at most three players from one club. A target marked CLUB_FULL means the squad already holds three from that club, so the outgoing player must be one of them. Respect this or the transfer is illegal.

HOW TO WRITE
Confident, analytical, concise. Use FPL-native language — differential, nailed, rotation risk, fixture swing, enabler, ceiling, floor, haul. Lead with the decision, then the reasoning.

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
  gameweek: number;
  horizon: number;
  managerName: string | null;
  teamName: string | null;
  squad: PlayerProjection[];
  optimal: OptimisedSquad;
  /** Bank, squad value, selling prices and club counts. */
  economics: SquadEconomics;
  /** Targets the manager could actually fund, each with its funding route. */
  transferTargets: FundedTarget[];
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

function targetRow(t: FundedTarget): string {
  const parts = [playerRow(t.player)];
  parts.push(
    `fundedBy:[${t.fundedBy.map((f) => `${f.name} £${f.sellPrice.toFixed(1)}m`).join(", ")}]`,
  );
  if (t.clubFull) parts.push("CLUB_FULL");
  return parts.join(" | ");
}

export function buildAnalysisPrompt(req: AnalysisRequest): string {
  const { gameweek, horizon, optimal, economics } = req;

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

  return `${identity}Analysing Gameweek ${gameweek}. Projection horizon: ${horizon} gameweeks.

=== BUDGET ===
Bank: £${economics.bank.toFixed(1)}m
Squad value at selling prices: £${economics.squadValue.toFixed(1)}m
Clubs with two or more players: ${clubs || "none"} (maximum three from any one club)

Legend: gw = expected points in GW${gameweek}. h = expected points across the full ${horizon}-gameweek horizon. mins = projected minutes. conf = model confidence 0-1. fix = upcoming opponents with home/away and FDR 1-5. fundedBy = squad players whose sale would pay for this target.

=== PROJECTION-OPTIMAL STARTING XI (${optimal.formationLabel}, ${optimal.expectedPoints.toFixed(1)} xPts) ===
${optimal.startingXI.map((p) => squadRow(p, economics)).join("\n")}

=== BENCH (in current order) ===
${optimal.bench.map((p) => squadRow(p, economics)).join("\n")}

=== TRANSFER TARGETS THIS MANAGER CAN AFFORD ===
${req.transferTargets.map(targetRow).join("\n")}${omitted}

Produce your gameweek analysis. Ground every claim in the numbers above.`;
}
