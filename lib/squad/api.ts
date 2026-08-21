/**
 * The half of a squad request that /api/projections and /api/analysis share.
 *
 * The two routes exist because the work divides cleanly on time: resolving a
 * squad and projecting it takes about two seconds, while the analyst takes
 * thirty to ninety. Running them in one request made people wait on the LLM to
 * see maths that had finished a minute earlier — which is backwards, because
 * the numbers are the product and the commentary is what goes on top.
 *
 * Splitting them means duplicating auth, validation, resolution and
 * persistence, so all of it lives here instead. A rule enforced in one route
 * and forgotten in the other is exactly the bug class this codebase already had
 * once, with squad validation living only in the browser.
 */

import { NextResponse } from "next/server";
import type { SupabaseClient, User } from "@supabase/supabase-js";
import { z } from "zod";

import { FplApiError } from "@/lib/fpl/client";
import {
  resolveSquad,
  SquadResolutionError,
  SQUAD_SIZE,
  type ResolvedSquad,
} from "./resolve";

export const SquadRequestSchema = z
  .object({
    entryId: z.number().int().positive().optional(),
    playerIds: z.array(z.number().int().positive()).length(SQUAD_SIZE).optional(),
    gameweek: z.number().int().min(1).max(38).optional(),
    horizon: z.number().int().min(1).max(10).default(5),
    /** Bypass the cached analysis and pay for a fresh one. Analysis only. */
    refresh: z.boolean().default(false),
  })
  .refine((b) => b.entryId !== undefined || b.playerIds !== undefined, {
    message: "Provide either an FPL team ID or a 15-player squad.",
  });

export type SquadRequest = z.infer<typeof SquadRequestSchema>;

/** A response to return immediately, or null to carry on. */
export type EarlyExit = NextResponse | null;

export async function requireUser(
  supabase: SupabaseClient,
): Promise<{ user: User } | { response: NextResponse }> {
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return {
      response: NextResponse.json({ error: "Not signed in." }, { status: 401 }),
    };
  }
  return { user };
}

export async function parseSquadRequest(
  request: Request,
): Promise<{ body: SquadRequest } | { response: NextResponse }> {
  try {
    return { body: SquadRequestSchema.parse(await request.json()) };
  } catch (err) {
    const message =
      err instanceof z.ZodError
        ? err.issues.map((i) => i.message).join("; ")
        : "Request body must be JSON.";
    return {
      response: NextResponse.json({ error: message }, { status: 400 }),
    };
  }
}

/**
 * Resolve and project, turning the two failure modes callers care about into
 * responses: a squad that cannot be used, and FPL being unreachable.
 */
export async function resolveForRequest(
  body: SquadRequest,
): Promise<{ resolved: ResolvedSquad } | { response: NextResponse }> {
  try {
    return {
      resolved: await resolveSquad({
        entryId: body.entryId,
        playerIds: body.playerIds,
        gameweek: body.gameweek,
        horizon: body.horizon,
      }),
    };
  } catch (err) {
    if (err instanceof SquadResolutionError) {
      return {
        response: NextResponse.json(
          { error: err.message, code: err.code },
          { status: err.code === "unknown_entry" ? 404 : 400 },
        ),
      };
    }
    if (err instanceof FplApiError) {
      return {
        response: NextResponse.json(
          { error: "The FPL API is not responding. Try again shortly." },
          { status: 503 },
        ),
      };
    }
    throw err;
  }
}

/**
 * Store the squad, keyed one per user per gameweek.
 *
 * A failure here is not cosmetic: without a squad row there is no cache key,
 * so every later refresh would silently pay for a fresh analysis.
 */
export async function persistSquad(
  supabase: SupabaseClient,
  userId: string,
  resolved: ResolvedSquad,
  entryId: number | undefined,
): Promise<{ squadId: string } | { response: NextResponse }> {
  const { data, error } = await supabase
    .from("squads")
    .upsert(
      {
        user_id: userId,
        gameweek: resolved.gameweek,
        fpl_entry_id: entryId ?? null,
        picks: resolved.playerIds,
        bank: resolved.bank,
        squad_value: resolved.squadValue,
        source: entryId ? "fpl_import" : "manual",
      },
      { onConflict: "user_id,gameweek" },
    )
    .select("id")
    .single();

  if (error || !data) {
    return {
      response: NextResponse.json(
        { error: "Could not save the squad, so the analysis was not run." },
        { status: 500 },
      ),
    };
  }
  return { squadId: data.id as string };
}
