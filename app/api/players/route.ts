import { NextResponse } from "next/server";

import { cached } from "@/lib/fpl/cache";
import {
  getBootstrap,
  getFixtures,
  previousSeasonName,
  resolveTargetGameweek,
} from "@/lib/fpl/client";
import { readPlayerHistory } from "@/lib/fpl/store";
import { buildContext, projectPlayer } from "@/lib/projections/engine";

export const runtime = "nodejs";

/**
 * Every selectable player with their projection, for the manual squad picker
 * and the comparison tool. Trimmed to what the UI renders — the full
 * projection objects would be an order of magnitude larger over the wire.
 */
async function buildPlayerList() {
  const [bootstrap, fixtures, lastSeason] = await Promise.all([
    getBootstrap(),
    getFixtures(),
    readPlayerHistory(previousSeasonName()),
  ]);
  const gameweek = resolveTargetGameweek(bootstrap);
  const ctx = buildContext(bootstrap, fixtures, lastSeason);

  const players = bootstrap.elements
    .map((el) => {
      const p = projectPlayer(el, ctx, gameweek, 5);
      return {
        id: p.playerId,
        name: p.webName,
        position: p.position,
        team: p.team,
        cost: p.cost,
        status: p.status,
        gw: Number(p.nextGameweekPoints.toFixed(2)),
        horizon: Number(p.totalExpectedPoints.toFixed(1)),
        minutes: Math.round(p.expectedMinutes),
        confidence: Number(p.confidence.toFixed(2)),
        basis: p.dataBasis,
        ppm: Number(p.pointsPerMillion.toFixed(2)),
        fixtures: p.perFixture.map((f) => ({
          opponent: f.opponent,
          home: f.isHome,
          fdr: f.difficulty,
        })),
        risks: p.risks,
      };
    })
    .sort((a, b) => b.horizon - a.horizon);

  return { gameweek, players };
}

/**
 * Projecting ~600 players is cheap but not free, and the inputs only move when
 * the FPL data does. Memoised on the same hourly cadence as the source.
 */
export async function GET() {
  return NextResponse.json(await cached("player-list", 3600, buildPlayerList));
}
