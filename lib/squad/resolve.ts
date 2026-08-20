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
import type { FplElement } from "@/lib/fpl/types";
import {
  buildContext,
  projectPlayer,
  type PlayerProjection,
} from "@/lib/projections/engine";
import { optimiseSquad, type OptimisedSquad } from "./optimizer";

export const DEFAULT_HORIZON = 5;
export const SQUAD_SIZE = 15;

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
  transferTargets: PlayerProjection[];
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
  const [bootstrap, fixtures] = await Promise.all([getBootstrap(), getFixtures()]);

  const gameweek = opts.gameweek ?? resolveTargetGameweek(bootstrap);
  const horizon = opts.horizon ?? DEFAULT_HORIZON;
  const ctx = buildContext(bootstrap, fixtures);

  const elementsById = new Map<number, FplElement>(
    bootstrap.elements.map((e) => [e.id, e]),
  );

  let playerIds: number[];
  let managerName: string | null = null;
  let teamName: string | null = null;
  let bank: number | null = null;
  let squadValue: number | null = null;

  if (opts.playerIds?.length) {
    if (opts.playerIds.length !== SQUAD_SIZE) {
      throw new SquadResolutionError(
        `A squad must contain exactly ${SQUAD_SIZE} players; received ${opts.playerIds.length}.`,
        "invalid_squad",
      );
    }
    playerIds = opts.playerIds;
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

    const picks = await getPicks(opts.entryId, gameweek);
    if (!picks) {
      // FPL only exposes picks once a gameweek's deadline has passed. Before
      // the first deadline of a season there is nothing to import at all.
      throw new SquadResolutionError(
        `FPL has not published picks for gameweek ${gameweek} yet. Picks become available once the deadline passes — until then, enter your squad manually.`,
        "picks_unavailable",
      );
    }
    playerIds = picks.picks.map((p) => p.element);
    bank = picks.entry_history.bank / 10;
    squadValue = picks.entry_history.value / 10;
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

  const optimal = optimiseSquad(squad);

  const allProjections = bootstrap.elements.map((e) =>
    projectPlayer(e, ctx, gameweek, horizon),
  );
  const transferTargets = pickTransferTargets(
    allProjections,
    new Set(playerIds),
  );

  return {
    gameweek,
    horizon,
    managerName,
    teamName,
    bank,
    squadValue,
    squad,
    optimal,
    transferTargets,
    playerIds,
  };
}
