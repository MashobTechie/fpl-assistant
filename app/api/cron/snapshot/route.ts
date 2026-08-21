import { NextResponse } from "next/server";

import {
  getBootstrapLive,
  getFixturesLive,
  resolveTargetGameweek,
} from "@/lib/fpl/client";
import { writeCachedPayload, writeDailySnapshot } from "@/lib/fpl/store";

export const runtime = "nodejs";
// Fetching and upserting ~600 players takes longer than the default budget.
export const maxDuration = 60;

/**
 * Refreshes the serving cache and records today's history row.
 *
 * Runs on a schedule in production (see vercel.json) and can be triggered by
 * hand for testing. Both paths present the same secret: without one this is a
 * public endpoint that hammers FPL on demand, which is both rude to them and a
 * trivial way to run up a bill against your own database.
 *
 * Safe to run repeatedly. The cache row is overwritten and the history row
 * upserts on (captured_on, player_id), so a double firing costs an extra fetch
 * and nothing else.
 */
export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret) {
    return NextResponse.json(
      { error: "CRON_SECRET is not configured, so this endpoint is disabled." },
      { status: 503 },
    );
  }

  // Vercel Cron sends the secret as a bearer token. Accepting a query
  // parameter too would put it in server logs and browser history.
  if (request.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "Not authorised." }, { status: 401 });
  }

  const startedAt = Date.now();

  try {
    // Deliberately the live fetchers: a job whose purpose is to refresh the
    // cache must not read from the cache it is refreshing.
    const [bootstrap, fixtures] = await Promise.all([
      getBootstrapLive(),
      getFixturesLive(),
    ]);

    const gameweek = resolveTargetGameweek(bootstrap);

    await Promise.all([
      writeCachedPayload("bootstrap", bootstrap),
      writeCachedPayload("fixtures", fixtures),
    ]);

    const snapshot = await writeDailySnapshot(bootstrap, gameweek);

    return NextResponse.json({
      ok: true,
      gameweek,
      capturedOn: snapshot.capturedOn,
      players: snapshot.players,
      fixtures: fixtures.length,
      tookMs: Date.now() - startedAt,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown failure.";
    console.error("[cron/snapshot] failed:", message);
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
