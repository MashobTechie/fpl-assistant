/**
 * Assembles everything an analysis needs: live FPL data, projections for the
 * squad, the optimal lineup, and a shortlist of transfer targets.
 */

import {
  getBootstrap,
  getEntry,
  getFixtures,
  getPicks,
  resolveTargetGameweek,
} from "@/lib/fpl/client";
import {
  getEntryHistory,
  getLive,
  previousSeasonName,
  resolvePicksGameweek,
} from "@/lib/fpl/client";
import { transferBudget, valueChips, type ChipValuation, type TransferBudget } from "./chips";
import { reviewGameweek, type GameweekReview } from "./review";
import { readPlayerHistory } from "@/lib/fpl/store";
import type { FplElement } from "@/lib/fpl/types";
import {
  buildContext,
  projectPlayer,
  type PlayerProjection,
} from "@/lib/projections/engine";
import {
  buildEconomics,
  fundableTargets,
  type FundedTarget,
  type SquadEconomics,
} from "./economics";
import { optimiseSquad, type OptimisedSquad } from "./optimizer";
import { rankTransfers, type TransferCandidate } from "./transfers";
import {
  squadCost,
  validateSquadComposition,
  validateSquadIds,
} from "./validate";

export const DEFAULT_HORIZON = 5;
export { SQUAD_SIZE } from "@/lib/types";

export class SquadResolutionError extends Error {
  constructor(
    message: string,
    readonly code:
      | "unknown_entry"
      | "picks_unavailable"
      | "invalid_squad"
      | "unknown_player",
  ) {
    super(message);
    this.name = "SquadResolutionError";
  }
}

export interface ResolvedSquad {
  gameweek: number;
  horizon: number;
  managerName: string | null;
  teamName: string | null;
  bank: number | null;
  squadValue: number | null;
  squad: PlayerProjection[];
  optimal: OptimisedSquad;
  transferTargets: FundedTarget[];
  /** Legal swaps, ranked by what they earn across the whole horizon. */
  transferCandidates: TransferCandidate[];
  /**
   * Matches the typical club has completed. The analyst needs this to know
   * what "this season's numbers" is actually worth — three matches and thirty
   * are the same dataBasis label and wildly different evidence.
   */
  matchesPlayed: number;
  /** Bank, squad value, selling prices and club counts. */
  economics: SquadEconomics;
  /** Targets dropped because nothing in the squad could fund them. */
  unaffordableTargets: number;
  /** Free transfers available, and what a further one costs. */
  transfers: TransferBudget;
  /** What each remaining chip is worth this gameweek. */
  chips: ChipValuation[];
  /** Last gameweek's result, when there is one and we know whose squad it was. */
  review: GameweekReview | null;
  playerIds: number[];
}

/** How many out-of-squad players to offer the analyst as transfer targets. */
const TARGET_SHORTLIST = 24;

/**
 * Best players outside the squad, spread across positions so the analyst is
 * not handed twenty midfielders. Budget options are included deliberately:
 * a transfer is usually funded by downgrading somewhere.
 */
function pickTransferTargets(
  all: PlayerProjection[],
  squadIds: Set<number>,
): PlayerProjection[] {
  const available = all.filter(
    (p) => !squadIds.has(p.playerId) && p.expectedMinutes > 30,
  );

  const targets: PlayerProjection[] = [];
  for (const position of ["GKP", "DEF", "MID", "FWD"] as const) {
    const inPosition = available.filter((p) => p.position === position);

    const byPoints = [...inPosition]
      .sort((a, b) => b.totalExpectedPoints - a.totalExpectedPoints)
      .slice(0, position === "GKP" ? 2 : 5);

    // Value picks: strong return per million, which is what funds an upgrade.
    const byValue = [...inPosition]
      .sort((a, b) => b.pointsPerMillion - a.pointsPerMillion)
      .slice(0, position === "GKP" ? 1 : 2);

    for (const p of [...byPoints, ...byValue]) {
      if (!targets.some((t) => t.playerId === p.playerId)) targets.push(p);
    }
  }

  return targets
    .sort((a, b) => b.totalExpectedPoints - a.totalExpectedPoints)
    .slice(0, TARGET_SHORTLIST);
}

interface ResolveOptions {
  gameweek?: number;
  horizon?: number;
  /** Manual squad: exactly 15 FPL element ids. Overrides the FPL import. */
  playerIds?: number[];
  entryId?: number;
}

export async function resolveSquad(opts: ResolveOptions): Promise<ResolvedSquad> {
  // Last season shrinks thin current-season samples. Fetched alongside, not
  // after, because it is needed before any projection runs.
  const [bootstrap, fixtures, lastSeason] = await Promise.all([
    getBootstrap(),
    getFixtures(),
    readPlayerHistory(previousSeasonName()),
  ]);

  const gameweek = opts.gameweek ?? resolveTargetGameweek(bootstrap);
  const horizon = opts.horizon ?? DEFAULT_HORIZON;
  const ctx = buildContext(bootstrap, fixtures, lastSeason);

  const elementsById = new Map<number, FplElement>(
    bootstrap.elements.map((e) => [e.id, e]),
  );

  let playerIds: number[];
  let managerName: string | null = null;
  let teamName: string | null = null;
  let bank: number | null = null;
  let squadValue: number | null = null;
  let manual = false;
  const sellPrices: Record<number, number> = {};

  if (opts.playerIds?.length) {
    const problems = validateSquadIds(opts.playerIds);
    if (problems.length > 0) {
      throw new SquadResolutionError(problems.join(" "), "invalid_squad");
    }
    playerIds = opts.playerIds;
    manual = true;
  } else if (opts.entryId) {
    const entry = await getEntry(opts.entryId).catch(() => null);
    if (!entry) {
      throw new SquadResolutionError(
        `No FPL team found with ID ${opts.entryId}.`,
        "unknown_entry",
      );
    }
    managerName = `${entry.player_first_name} ${entry.player_last_name}`.trim();
    teamName = entry.name;

    // Import the last LOCKED squad, not the gameweek being analysed. Those are
    // different numbers: picks for the gameweek under analysis are, by
    // definition, not published yet.
    const picksGameweek = resolvePicksGameweek(bootstrap);
    if (picksGameweek === null) {
      throw new SquadResolutionError(
        "The season has not started, so FPL has not locked any squad to import yet. " +
          "Build your squad manually — it is the only way in before the first deadline.",
        "picks_unavailable",
      );
    }

    const picks = await getPicks(opts.entryId, picksGameweek);
    if (!picks) {
      throw new SquadResolutionError(
        `FPL has no squad on record for team ${opts.entryId} in gameweek ${picksGameweek}. ` +
          "If you joined partway through the season, build your squad manually.",
        "picks_unavailable",
      );
    }
    playerIds = picks.picks.map((p) => p.element);
    bank = picks.entry_history.bank / 10;
    squadValue = picks.entry_history.value / 10;
    // FPL returns only half of any rise since purchase, so what a player sells
    // for is not what he is worth today. Advice built on market price does not
    // add up at the point of making the transfer.
    for (const pick of picks.picks) {
      if (typeof pick.selling_price === "number") {
        sellPrices[pick.element] = pick.selling_price / 10;
      }
    }
  } else {
    throw new SquadResolutionError(
      "Provide either an FPL team ID or a manual squad.",
      "invalid_squad",
    );
  }

  const squad = playerIds.map((id) => {
    const element = elementsById.get(id);
    if (!element) {
      throw new SquadResolutionError(
        `Unknown FPL player id ${id}.`,
        "unknown_player",
      );
    }
    return projectPlayer(element, ctx, gameweek, horizon);
  });

  // Only reachable for a manual squad: an imported one is legal by
  // construction, having been built inside FPL's own rules.
  const problems = validateSquadComposition(squad, { enforceBudget: manual });
  if (problems.length > 0) {
    throw new SquadResolutionError(problems.join(" "), "invalid_squad");
  }

  // A manual squad is priced at today's cost, which is what the manager would
  // pay to assemble it now. An imported squad reports the value FPL holds.
  if (manual) squadValue = squadCost(squad);

  // The optimiser throws plain Errors for shapes it cannot field. Validation
  // above should make those unreachable, but an escaped one would surface as a
  // 500 with a stack trace rather than a usable message.
  let optimal: OptimisedSquad;
  try {
    optimal = optimiseSquad(squad);
  } catch (err) {
    throw new SquadResolutionError(
      err instanceof Error ? err.message : "This squad cannot field a legal XI.",
      "invalid_squad",
    );
  }

  const allProjections = bootstrap.elements.map((e) =>
    projectPlayer(e, ctx, gameweek, horizon),
  );
  const economics = buildEconomics(squad, { bank, sellPrices });
  const { affordable, unaffordable } = fundableTargets(
    pickTransferTargets(allProjections, new Set(playerIds)),
    squad,
    economics,
  );

  // Chips, transfers and the retrospective all need the manager's identity, so
  // they are only available for an imported squad — a manual fifteen has no
  // history to read.
  let history = null;
  let review: GameweekReview | null = null;
  if (opts.entryId) {
    history = await getEntryHistory(opts.entryId).catch(() => null);
    const lastPlayed = resolvePicksGameweek(bootstrap);
    if (lastPlayed !== null) {
      const [pastPicks, live] = await Promise.all([
        getPicks(opts.entryId, lastPlayed).catch(() => null),
        getLive(lastPlayed).catch(() => null),
      ]);
      if (pastPicks && live) {
        review = reviewGameweek(
          lastPlayed,
          pastPicks,
          live,
          bootstrap,
          history?.current.find((c) => c.event === lastPlayed)?.overall_rank ?? null,
        );
      }
    }
  }

  const transferCandidates = rankTransfers(
    squad,
    affordable.map((t) => t.player),
    economics,
    gameweek,
    horizon,
  );

  // The modal club, not the maximum: postponements leave one or two clubs
  // behind, and the median is what most of the squad has actually played.
  const played = [...ctx.matchesPlayedByTeam.values()].sort((a, b) => a - b);
  const matchesPlayed = played.length
    ? played[Math.floor(played.length / 2)]
    : ctx.completedGameweeks;

  return {
    gameweek,
    matchesPlayed,
    horizon,
    transfers: transferBudget(history, gameweek),
    chips: valueChips(optimal, squad, gameweek, history, horizon),
    review,
    managerName,
    teamName,
    bank,
    squadValue,
    squad,
    optimal,
    transferTargets: affordable,
    transferCandidates,
    economics,
    unaffordableTargets: unaffordable,
    playerIds,
  };
}
