import { NextResponse } from "next/server";
import { z } from "zod";

import { analyseGameweek, AnalystError } from "@/lib/ai/analyst";
import { FplApiError } from "@/lib/fpl/client";
import {
  resolveSquad,
  SquadResolutionError,
  SQUAD_SIZE,
} from "@/lib/squad/resolve";
import { createClient } from "@/lib/supabase/server";

export const runtime = "nodejs";
// Claude reasoning over a full squad takes longer than the default budget.
export const maxDuration = 120;

const BodySchema = z
  .object({
    entryId: z.number().int().positive().optional(),
    playerIds: z.array(z.number().int().positive()).length(SQUAD_SIZE).optional(),
    gameweek: z.number().int().min(1).max(38).optional(),
    horizon: z.number().int().min(1).max(10).default(5),
    /** Bypass the cached analysis and pay for a fresh one. */
    refresh: z.boolean().default(false),
  })
  .refine((b) => b.entryId !== undefined || b.playerIds !== undefined, {
    message: "Provide either an FPL team ID or a 15-player squad.",
  });

export async function POST(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Not signed in." }, { status: 401 });
  }

  let body: z.infer<typeof BodySchema>;
  try {
    body = BodySchema.parse(await request.json());
  } catch (err) {
    const message =
      err instanceof z.ZodError
        ? err.issues.map((i) => i.message).join("; ")
        : "Request body must be JSON.";
    return NextResponse.json({ error: message }, { status: 400 });
  }

  // ---- Projections (deterministic, cheap, always recomputed) -------------
  let resolved;
  try {
    resolved = await resolveSquad({
      entryId: body.entryId,
      playerIds: body.playerIds,
      gameweek: body.gameweek,
      horizon: body.horizon,
    });
  } catch (err) {
    if (err instanceof SquadResolutionError) {
      return NextResponse.json(
        { error: err.message, code: err.code },
        { status: err.code === "unknown_entry" ? 404 : 400 },
      );
    }
    if (err instanceof FplApiError) {
      return NextResponse.json(
        { error: "The FPL API is not responding. Try again shortly." },
        { status: 503 },
      );
    }
    throw err;
  }

  // ---- Persist the squad -------------------------------------------------
  // Failing here is not cosmetic: without a squad row there is no cache key,
  // so every subsequent refresh would silently pay for a fresh Opus call.
  // Fail loudly rather than bill the user for a broken cache.
  const { data: squadRow, error: squadError } = await supabase
    .from("squads")
    .upsert(
      {
        user_id: user.id,
        gameweek: resolved.gameweek,
        fpl_entry_id: body.entryId ?? null,
        picks: resolved.playerIds,
        bank: resolved.bank,
        squad_value: resolved.squadValue,
        source: body.entryId ? "fpl_import" : "manual",
      },
      { onConflict: "user_id,gameweek" },
    )
    .select("id")
    .single();

  if (squadError || !squadRow) {
    return NextResponse.json(
      { error: "Could not save the squad, so the analysis was not run." },
      { status: 500 },
    );
  }

  // ---- Reuse a cached analysis unless asked not to -----------------------
  // An LLM call per dashboard refresh would make the product expensive for no
  // benefit: the same squad and gameweek yields the same reasoning.
  if (!body.refresh) {
    const { data: cached } = await supabase
      .from("analyses")
      .select("analysis, projections, created_at")
      .eq("user_id", user.id)
      .eq("squad_id", squadRow.id)
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
    if (err instanceof AnalystError) {
      return NextResponse.json(
        { error: err.message, retryable: err.retryable },
        { status: err.retryable ? 503 : 500 },
      );
    }
    throw err;
  }

  await supabase.from("analyses").insert({
    user_id: user.id,
    squad_id: squadRow.id,
    gameweek: resolved.gameweek,
    horizon: resolved.horizon,
    model: process.env.ANTHROPIC_MODEL ?? "claude-opus-5",
    projections: resolved.squad,
    analysis,
  });

  return NextResponse.json({
    gameweek: resolved.gameweek,
    horizon: resolved.horizon,
    squad: resolved.squad,
    optimal: resolved.optimal,
    analysis,
    cached: false,
    generatedAt: new Date().toISOString(),
  });
}
