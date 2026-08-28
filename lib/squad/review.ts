/**
 * What happened last gameweek, and what should have happened.
 *
 * Entirely deterministic. Once a gameweek finishes, the best possible XI from
 * a squad is not a matter of opinion — every player's score is known, so the
 * optimal lineup is a solved problem, exactly as the forward-looking optimiser
 * solves it from projections. The same code answers both questions; only the
 * score function changes.
 *
 * This is the honest half of the product. A tool that only ever projects
 * forward never has to show whether it was right.
 */

import type { FplBootstrap, FplLive, FplPicks } from "@/lib/fpl/types";
import { POSITION_NAME } from "@/lib/fpl/types";
import { legalFormations } from "./optimizer";

export interface ReviewedPlayer {
  playerId: number;
  webName: string;
  position: "GKP" | "DEF" | "MID" | "FWD";
  team: string;
  points: number;
  minutes: number;
  started: boolean;
  isCaptain: boolean;
  /** Points this player actually contributed, after any captain multiplier. */
  counted: number;
}

export interface GameweekReview {
  gameweek: number;
  /** What the manager actually scored, after transfer hits. */
  points: number;
  transferCost: number;
  overallRank: number | null;
  chipPlayed: string | null;

  squad: ReviewedPlayer[];
  captain: ReviewedPlayer | null;

  /** Points left on the bench — the cost of the lineup, not the squad. */
  benchPoints: number;
  /** The best XI available in hindsight, and what it would have scored. */
  bestPossible: number;
  bestPossibleXI: ReviewedPlayer[];
  /** bestPossible − actual XI score. Zero means the lineup was perfect. */
  lineupCost: number;

  /** The player who should have worn the armband, and what it cost not to. */
  bestCaptain: ReviewedPlayer | null;
  captainCost: number;

  /** Plain-language findings, ordered by how much each one cost. */
  lessons: string[];
}

/**
 * Best XI by actual points, solved the same way the forward-looking optimiser
 * solves it: enumerate the nine legal formations and take the best.
 */
function bestXIByPoints(squad: ReviewedPlayer[]): {
  xi: ReviewedPlayer[];
  total: number;
} {
  const byPoints = (a: ReviewedPlayer, b: ReviewedPlayer) => b.points - a.points;
  const keepers = squad.filter((p) => p.position === "GKP").sort(byPoints);
  const defs = squad.filter((p) => p.position === "DEF").sort(byPoints);
  const mids = squad.filter((p) => p.position === "MID").sort(byPoints);
  const fwds = squad.filter((p) => p.position === "FWD").sort(byPoints);

  let best: { xi: ReviewedPlayer[]; total: number } = { xi: [], total: -Infinity };
  if (keepers.length === 0) return { xi: [], total: 0 };

  for (const f of legalFormations()) {
    if (defs.length < f.defenders || mids.length < f.midfielders || fwds.length < f.forwards) {
      continue;
    }
    const xi = [
      keepers[0],
      ...defs.slice(0, f.defenders),
      ...mids.slice(0, f.midfielders),
      ...fwds.slice(0, f.forwards),
    ];
    const total = xi.reduce((s, p) => s + p.points, 0);
    if (total > best.total) best = { xi, total };
  }
  return best;
}

export function reviewGameweek(
  gameweek: number,
  picks: FplPicks,
  live: FplLive,
  bootstrap: FplBootstrap,
  overallRank: number | null = null,
): GameweekReview {
  const pointsById = new Map(live.elements.map((e) => [e.id, e.stats]));
  const elementsById = new Map(bootstrap.elements.map((e) => [e.id, e]));
  const teamsById = new Map(bootstrap.teams.map((t) => [t.id, t.short_name]));

  const squad: ReviewedPlayer[] = picks.picks.map((pick) => {
    const el = elementsById.get(pick.element);
    const stats = pointsById.get(pick.element);
    const points = stats?.total_points ?? 0;
    return {
      playerId: pick.element,
      webName: el?.web_name ?? `#${pick.element}`,
      position: POSITION_NAME[(el?.element_type ?? 3) as 1 | 2 | 3 | 4],
      team: el ? (teamsById.get(el.team) ?? "???") : "???",
      points,
      minutes: stats?.minutes ?? 0,
      // multiplier is 0 for an unused bench player, 1 for a starter, 2 or 3
      // for the captain — so it encodes both selection and the armband.
      started: pick.multiplier > 0,
      isCaptain: pick.is_captain,
      counted: points * pick.multiplier,
    };
  });

  const starters = squad.filter((p) => p.started);
  const bench = squad.filter((p) => !p.started);
  const actualXI = starters.reduce((s, p) => s + p.points, 0);
  const benchPoints = bench.reduce((s, p) => s + p.points, 0);

  const { xi: bestPossibleXI, total: bestPossible } = bestXIByPoints(squad);
  const lineupCost = Math.max(0, bestPossible - actualXI);

  const captain = squad.find((p) => p.isCaptain) ?? null;
  // Only starters can be captained, and the armband doubles — so what it cost
  // is the gap to the best starter, counted once more.
  const bestCaptain =
    starters.length > 0
      ? starters.reduce((a, b) => (b.points > a.points ? b : a))
      : null;
  const captainCost =
    captain && bestCaptain ? Math.max(0, bestCaptain.points - captain.points) : 0;

  const lessons: string[] = [];
  if (lineupCost > 0) {
    const missed = bestPossibleXI.filter((p) => !p.started);
    lessons.push(
      `Left ${lineupCost} point${lineupCost === 1 ? "" : "s"} on the bench — ` +
        `${missed.map((p) => `${p.webName} (${p.points})`).join(", ")} should have started.`,
    );
  }
  if (captainCost > 0 && captain && bestCaptain) {
    lessons.push(
      `The armband on ${bestCaptain.webName} (${bestCaptain.points}) instead of ` +
        `${captain.webName} (${captain.points}) was worth ${captainCost} more.`,
    );
  }
  const blanked = starters.filter((p) => p.minutes === 0);
  if (blanked.length > 0) {
    lessons.push(
      `${blanked.map((p) => p.webName).join(", ")} did not play at all — ` +
        `${blanked.length === 1 ? "a start" : "starts"} worth zero.`,
    );
  }
  if (lessons.length === 0) {
    lessons.push("Nothing was left on the table — the best available XI started.");
  }

  return {
    gameweek,
    points: picks.entry_history.points ?? 0,
    transferCost: picks.entry_history.event_transfers_cost ?? 0,
    overallRank,
    chipPlayed: picks.active_chip ?? null,
    squad,
    captain,
    benchPoints,
    bestPossible,
    bestPossibleXI,
    lineupCost,
    bestCaptain,
    captainCost,
    lessons,
  };
}
