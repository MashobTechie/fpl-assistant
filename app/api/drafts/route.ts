import { NextResponse } from "next/server";
import { z } from "zod";

import { ChipSchema, requireUser, TransfersSchema } from "@/lib/squad/api";
import { MAX_SAVED_DRAFTS_PER_GAMEWEEK } from "@/lib/types";
import { createClient } from "@/lib/supabase/server";

export const runtime = "nodejs";

/**
 * Saved transfer drafts.
 *
 * A draft is stored as the question — the swaps and the chip — and never as
 * the answer. Prices and projections move daily, so a stored verdict would be
 * read as current while describing last week's market; recomputing it is free,
 * because the engine needs no API key. The resulting fifteen are not stored
 * either: make one of the moves for real, re-import, and a stored fifteen is a
 * squad the manager never had. Re-applying the swaps either works or fails
 * loudly, and loudly is the honest outcome.
 *
 * Rows are owned and RLS-protected, so `user_id` is a filter for clarity here,
 * not the access control. A query that forgot it would still return nothing
 * belonging to anyone else.
 */

const SaveSchema = z.object({
  gameweek: z.number().int().min(1).max(38),
  name: z.string().trim().min(1).max(60),
  transfers: TransfersSchema.min(1),
  chip: ChipSchema.nullish(),
  entryId: z.number().int().positive().nullish(),
});

export async function GET(request: Request) {
  const supabase = await createClient();
  const auth = await requireUser(supabase);
  if ("response" in auth) return auth.response;

  const raw = new URL(request.url).searchParams.get("gameweek");
  const gameweek = raw === null ? null : Number(raw);
  if (gameweek !== null && !Number.isInteger(gameweek)) {
    return NextResponse.json({ error: "gameweek must be a number." }, { status: 400 });
  }

  let query = supabase
    .from("drafts")
    .select("id, gameweek, name, transfers, chip, fpl_entry_id, updated_at")
    .eq("user_id", auth.user.id)
    .order("updated_at", { ascending: false })
    .limit(60);
  if (gameweek !== null) query = query.eq("gameweek", gameweek);

  const { data, error } = await query;
  if (error) {
    return NextResponse.json({ error: "Could not read your saved drafts." }, { status: 500 });
  }
  return NextResponse.json({ drafts: data ?? [] });
}

export async function POST(request: Request) {
  const supabase = await createClient();
  const auth = await requireUser(supabase);
  if ("response" in auth) return auth.response;

  let body: z.infer<typeof SaveSchema>;
  try {
    body = SaveSchema.parse(await request.json());
  } catch (err) {
    const message =
      err instanceof z.ZodError
        ? err.issues.map((i) => `${i.path.join(".") || "body"}: ${i.message}`).join("; ")
        : "Request body must be JSON.";
    return NextResponse.json({ error: message }, { status: 400 });
  }

  // A ceiling, so a client in a loop cannot fill the table. Checked before the
  // upsert and only against other names: re-saving one you already have is an
  // edit, and an edit must not be refused for being the thirteenth.
  const { data: existing, error: countError } = await supabase
    .from("drafts")
    .select("name")
    .eq("user_id", auth.user.id)
    .eq("gameweek", body.gameweek);
  if (countError) {
    return NextResponse.json({ error: "Could not save that draft." }, { status: 500 });
  }
  const isNew = !(existing ?? []).some((d) => d.name === body.name);
  if (isNew && (existing ?? []).length >= MAX_SAVED_DRAFTS_PER_GAMEWEEK) {
    return NextResponse.json(
      {
        error:
          `You have ${MAX_SAVED_DRAFTS_PER_GAMEWEEK} drafts saved for gameweek ` +
          `${body.gameweek}. Delete one, or save over it by reusing its name.`,
      },
      { status: 409 },
    );
  }

  const { data, error } = await supabase
    .from("drafts")
    .upsert(
      {
        user_id: auth.user.id,
        gameweek: body.gameweek,
        name: body.name,
        transfers: body.transfers,
        chip: body.chip ?? null,
        fpl_entry_id: body.entryId ?? null,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "user_id,gameweek,name" },
    )
    .select("id, gameweek, name, transfers, chip, fpl_entry_id, updated_at")
    .single();

  if (error || !data) {
    return NextResponse.json({ error: "Could not save that draft." }, { status: 500 });
  }
  return NextResponse.json({ draft: data });
}

export async function DELETE(request: Request) {
  const supabase = await createClient();
  const auth = await requireUser(supabase);
  if ("response" in auth) return auth.response;

  const id = new URL(request.url).searchParams.get("id");
  if (!id) {
    return NextResponse.json({ error: "Which draft? Pass ?id=." }, { status: 400 });
  }

  const { error } = await supabase
    .from("drafts")
    .delete()
    .eq("id", id)
    .eq("user_id", auth.user.id);
  if (error) {
    return NextResponse.json({ error: "Could not delete that draft." }, { status: 500 });
  }
  return NextResponse.json({ deleted: true });
}
