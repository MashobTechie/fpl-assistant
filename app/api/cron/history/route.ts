import { NextResponse } from "next/server";

import {
  getBootstrapLive,
  getElementSummary,
  previousSeasonName,
} from "@/lib/fpl/client";
import { toTotals } from "@/lib/fpl/history";
import { writePlayerHistory } from "@/lib/fpl/store";

export const runtime = "nodejs";
// ~600 sequential requests, throttled. Well inside this, but not by much.
export const maxDuration = 300;

/** Pause between FPL requests, so a backfill does not look like an attack. */
const REQUEST_GAP_MS = 60;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Back-fill last season's per-player totals.
 *
 * FPL zeroes every season total at the first deadline of a new season, and the
 * projection engine reads those fields — so without this the whole model
 * degrades to price-based guesses the moment a season starts. Previous seasons
 * survive only at /element-summary/{id}/, one request per player, which is why
 * this runs as a job and stores the result rather than fetching per projection.
 *
 * Safe to re-run: rows upsert on (element_code, season_name). Worth running
 * once before a season starts and again shortly after the first deadline.
 */
export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET;
  if (secret) {
    const auth = request.headers.get("authorization");
    if (auth !== `Bearer ${secret}`) {
      return NextResponse.json({ error: "Unauthorised." }, { status: 401 });
    }
  }

  const season =
    new URL(request.url).searchParams.get("season") ?? previousSeasonName();

  try {
    // Live, not cached: this job exists to repair the cache's inputs.
    const bootstrap = await getBootstrapLive();

    const rows = [];
    let missing = 0;

    for (const element of bootstrap.elements) {
      try {
        const summary = await getElementSummary(element.id);
        const past = summary.history_past?.find(
          (p) => p.season_name === season,
        );
        if (!past) {
          missing++;
        } else {
          rows.push({
            ...toTotals(past as unknown as Record<string, unknown>),
            // The code, not the id: FPL reassigns ids between seasons.
            element_code: element.code,
            season_name: season,
            end_cost: past.end_cost ?? element.now_cost,
          });
        }
      } catch {
        missing++;
      }
      await sleep(REQUEST_GAP_MS);
    }

    const written = await writePlayerHistory(rows);

    return NextResponse.json({
      ok: true,
      season,
      players: bootstrap.elements.length,
      written,
      withoutHistory: missing,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[cron/history] failed:", message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
