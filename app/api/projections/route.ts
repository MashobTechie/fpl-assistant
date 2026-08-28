import { NextResponse } from "next/server";

import {
  parseSquadRequest,
  persistSquad,
  requireUser,
  resolveForRequest,
} from "@/lib/squad/api";
import { createClient } from "@/lib/supabase/server";

export const runtime = "nodejs";

/**
 * Everything the deterministic engine can say about a squad, and nothing the
 * analyst does.
 *
 * This is the fast half: FPL data, a projection for all fifteen players, and
 * the exact optimal XI, in about two seconds. The dashboard renders it
 * immediately and requests the written analysis separately, so a manager sees
 * their lineup at once rather than waiting on an LLM for numbers that are
 * already computed.
 *
 * It also costs nothing to serve — no API key is involved — which makes it the
 * useful thing to fall back on if the analyst is unavailable or a user has
 * spent their daily allowance.
 */
export async function POST(request: Request) {
  const supabase = await createClient();

  const auth = await requireUser(supabase);
  if ("response" in auth) return auth.response;

  const parsed = await parseSquadRequest(request);
  if ("response" in parsed) return parsed.response;

  const result = await resolveForRequest(parsed.body);
  if ("response" in result) return result.response;
  const { resolved } = result;

  const stored = await persistSquad(
    supabase,
    auth.user.id,
    resolved,
    parsed.body.entryId,
  );
  if ("response" in stored) return stored.response;

  return NextResponse.json({
    gameweek: resolved.gameweek,
    horizon: resolved.horizon,
    squad: resolved.squad,
    optimal: resolved.optimal,
    managerName: resolved.managerName,
    teamName: resolved.teamName,
    bank: resolved.bank,
    squadValue: resolved.squadValue,
    // All free and all deterministic, so they belong on the fast half rather
    // than behind a paid analyst call.
    review: resolved.review,
    chips: resolved.chips,
    transfers: resolved.transfers,
  });
}
