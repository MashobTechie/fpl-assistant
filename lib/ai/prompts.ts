/**
 * Prompt construction for the analyst.
 *
 * The system prompt is deliberately frozen — no dates, no per-request values —
 * so it stays a stable cache prefix across every user and every gameweek.
 * Everything that varies goes in the user message.
 */

import type { PlayerProjection } from "@/lib/projections/engine";
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

HOW TO WRITE
Confident, analytical, concise. Use FPL-native language — differential, nailed, rotation risk, fixture swing, enabler, ceiling, floor, haul. Lead with the decision, then the reasoning.

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
  bank: number | null;
  squad: PlayerProjection[];
  optimal: OptimisedSquad;
  /** Best available players outside the squad, for transfer suggestions. */
  transferTargets: PlayerProjection[];
}

export function buildAnalysisPrompt(req: AnalysisRequest): string {
  const { gameweek, horizon, optimal } = req;

  const identity =
    req.teamName || req.managerName
      ? `Manager: ${req.managerName ?? "unknown"} — "${req.teamName ?? "unnamed"}"\n`
      : "";
  const bank = req.bank !== null ? `Bank available: £${req.bank.toFixed(1)}m\n` : "";

  return `${identity}${bank}Analysing Gameweek ${gameweek}. Projection horizon: ${horizon} gameweeks.

Legend: gw = expected points in GW${gameweek}. h = expected points across the full ${horizon}-gameweek horizon. mins = projected minutes. conf = model confidence 0-1. fix = upcoming opponents with home/away and FDR 1-5.

=== PROJECTION-OPTIMAL STARTING XI (${optimal.formationLabel}, ${optimal.expectedPoints.toFixed(1)} xPts) ===
${optimal.startingXI.map(playerRow).join("\n")}

=== BENCH (in current order) ===
${optimal.bench.map(playerRow).join("\n")}

=== TRANSFER TARGETS OUTSIDE THE SQUAD ===
${req.transferTargets.map(playerRow).join("\n")}

Produce your gameweek analysis. Ground every claim in the numbers above.`;
}
