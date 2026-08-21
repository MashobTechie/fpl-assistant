import { NextResponse } from "next/server";

import { analyseGameweek, AnalystError } from "@/lib/ai/analyst";
import { releaseAnalysis, reserveAnalysis } from "@/lib/ai/rate-limit";
import {
  parseSquadRequest,
  persistSquad,
  requireUser,
  resolveForRequest,
} from "@/lib/squad/api";
import { squadHash } from "@/lib/squad/validate";
import { createClient } from "@/lib/supabase/server";

export const runtime = "nodejs";
// Claude reasoning over a full squad takes longer than the default budget.
export const maxDuration = 120;

/**
 * The reasoning half. /api/projections serves the numbers in about two seconds;
 * this takes thirty to ninety, because the analyst genuinely reasons before it
 * answers. The dashboard calls them in that order so the wait is only ever for
 * the commentary.
 */
export async function POST(request: Request) {
  const supabase = await createClient();

  const auth = await requireUser(supabase);
  if ("response" in auth) return auth.response;
  const user = auth.user;

  const parsed = await parseSquadRequest(request);
  if ("response" in parsed) return parsed.response;
  const body = parsed.body;

  const result = await resolveForRequest(body);
  if ("response" in result) return result.response;
  const { resolved } = result;

  const stored = await persistSquad(supabase, user.id, resolved, body.entryId);
  if ("response" in stored) return stored.response;
  const squadRow = { id: stored.squadId };

  // ---- Reuse a cached analysis unless asked not to -----------------------
  // An LLM call per dashboard refresh would make the product expensive for no
  // benefit: the same squad and gameweek yields the same reasoning.
  // Keyed on the picks themselves. squads carries unique (user_id, gameweek),
  // so a squad changed before the deadline keeps its row id — keying on
  // squad_id would hand back the previous squad's reasoning as `cached: true`.
  const hash = squadHash(resolved.playerIds);

  if (!body.refresh) {
    const { data: cached } = await supabase
      .from("analyses")
      .select("analysis, projections, created_at")
      .eq("user_id", user.id)
      .eq("squad_hash", hash)
      .eq("gameweek", resolved.gameweek)
      .eq("horizon", resolved.horizon)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (cached) {
      return NextResponse.json({
        gameweek: resolved.gameweek,
        horizon: resolved.horizon,
        squad: resolved.squad,
        optimal: resolved.optimal,
        analysis: cached.analysis,
        cached: true,
        generatedAt: cached.created_at,
      });
    }
  }

  // ---- Spend control -----------------------------------------------------
  // Past this point the request costs money, so claim the allowance first.
  // Reserving before the call rather than counting after it is what closes the
  // window where concurrent requests all see the same pre-call total.
  const reservation = await reserveAnalysis(supabase);
  if (!reservation.allowed) {
    await releaseAnalysis(supabase);
    return NextResponse.json(
      {
        error:
          `You have used all ${reservation.limit} analyses for today. ` +
          "The limit resets at midnight UTC. Your saved analyses are still available.",
        limit: reservation.limit,
      },
      { status: 429 },
    );
  }

  // ---- Reasoning layer ---------------------------------------------------
  let analysis;
  try {
    analysis = await analyseGameweek({
      gameweek: resolved.gameweek,
      horizon: resolved.horizon,
      managerName: resolved.managerName,
      teamName: resolved.teamName,
      bank: resolved.bank,
      squad: resolved.squad,
      optimal: resolved.optimal,
      transferTargets: resolved.transferTargets,
    });
  } catch (err) {
    await releaseAnalysis(supabase);
    if (err instanceof AnalystError) {
      return NextResponse.json(
        { error: err.message, retryable: err.retryable },
        { status: err.retryable ? 503 : 500 },
      );
    }
    throw err;
  }

  // A failure here is not fatal — the analysis is already paid for and is
  // returned below — but it means the next identical request misses the cache
  // and bills again, so it must not pass silently.
  const { error: insertError } = await supabase.from("analyses").insert({
    user_id: user.id,
    squad_id: squadRow.id,
    squad_hash: hash,
    gameweek: resolved.gameweek,
    horizon: resolved.horizon,
    model: process.env.ANTHROPIC_MODEL ?? "claude-opus-5",
    projections: resolved.squad,
    analysis,
  });
  if (insertError) {
    console.error(
      "[analysis] failed to cache a paid-for analysis; the next identical " +
        `request will bill again: ${insertError.message}`,
    );
  }

  return NextResponse.json({
    gameweek: resolved.gameweek,
    horizon: resolved.horizon,
    squad: resolved.squad,
    optimal: resolved.optimal,
    analysis,
    cached: false,
    generatedAt: new Date().toISOString(),
    usage: { used: reservation.used, limit: reservation.limit },
  });
}
