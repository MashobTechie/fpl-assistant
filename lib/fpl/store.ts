import { createAdminClient } from "@/lib/supabase/admin";
import type { FplBootstrap } from "./types";

/**
 * Postgres-backed storage for FPL data.
 *
 * Two jobs, deliberately kept apart:
 *
 *   fpl_cache             the current payload, overwritten. A serving layer, so
 *                         every instance agrees on today's prices and an FPL
 *                         outage degrades the app instead of stopping it.
 *
 *   fpl_player_snapshots  one row per player per day, appended. FPL overwrites
 *                         price and ownership in place and publishes no history
 *                         endpoint, so anything not captured is unrecoverable.
 *
 * Every read degrades to a miss when Supabase is not configured, so the CLI
 * scripts — which have no database and do not need one — fetch live from FPL
 * exactly as they did before this layer existed.
 */

/** False in the CLI scripts, which have no Supabase credentials loaded. */
function storeConfigured(): boolean {
  return Boolean(
    process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY,
  );
}

/** Reads a stored payload, or null if absent or older than maxAgeSeconds. */
export async function readCachedPayload<T>(
  key: string,
  maxAgeSeconds: number,
): Promise<T | null> {
  if (!storeConfigured()) return null;
  try {
    const supabase = createAdminClient();
    const { data, error } = await supabase
      .from("fpl_cache")
      .select("payload, fetched_at")
      .eq("key", key)
      .maybeSingle();

    if (error || !data) return null;

    const age = (Date.now() - Date.parse(data.fetched_at)) / 1000;
    if (age > maxAgeSeconds) return null;

    return data.payload as T;
  } catch {
    // A cache miss and an unreachable database are the same thing to the
    // caller: fetch it live instead. Never let this path break a request.
    return null;
  }
}

export async function writeCachedPayload(
  key: string,
  payload: unknown,
): Promise<void> {
  if (!storeConfigured()) return;
  try {
    const supabase = createAdminClient();
    await supabase
      .from("fpl_cache")
      .upsert(
        { key, payload, fetched_at: new Date().toISOString() },
        { onConflict: "key" },
      );
  } catch (err) {
    console.error(`[fpl-store] could not write cache "${key}":`, err);
  }
}

/** Postgres numerics arrive as strings; empty and absent both mean "no value". */
function toNumber(value: string | number | null | undefined): number | null {
  if (value === null || value === undefined || value === "") return null;
  const n = typeof value === "number" ? value : Number.parseFloat(value);
  return Number.isFinite(n) ? n : null;
}

export interface SnapshotResult {
  capturedOn: string;
  players: number;
}

/**
 * Records today's row for every player.
 *
 * Upserts on (captured_on, player_id), so running this more than once a day
 * refreshes the day's figures rather than accumulating duplicates. That is what
 * lets the job run on whatever cadence the host allows while the history stays
 * one row per player per day.
 */
export async function writeDailySnapshot(
  bootstrap: FplBootstrap,
  gameweek: number | null,
): Promise<SnapshotResult> {
  const supabase = createAdminClient();
  // UTC, so a snapshot does not land on two different dates depending on where
  // the server happens to be running.
  const capturedOn = new Date().toISOString().slice(0, 10);

  const rows = bootstrap.elements.map((el) => ({
    captured_on: capturedOn,
    player_id: el.id,
    gameweek,
    now_cost: el.now_cost,
    cost_change_event: el.cost_change_event ?? null,
    selected_by_percent: toNumber(el.selected_by_percent),
    transfers_in_event: el.transfers_in_event ?? null,
    transfers_out_event: el.transfers_out_event ?? null,
    total_points: el.total_points,
    minutes: el.minutes,
    form: toNumber(el.form),
    status: el.status,
    captured_at: new Date().toISOString(),
  }));

  // ~600 rows is one comfortable statement, but chunking keeps the request
  // well inside PostgREST's payload limit if the league ever expands.
  const CHUNK = 300;
  for (let i = 0; i < rows.length; i += CHUNK) {
    const { error } = await supabase
      .from("fpl_player_snapshots")
      .upsert(rows.slice(i, i + CHUNK), { onConflict: "captured_on,player_id" });
    if (error) {
      throw new Error(`snapshot write failed at row ${i}: ${error.message}`);
    }
  }

  return { capturedOn, players: rows.length };
}
