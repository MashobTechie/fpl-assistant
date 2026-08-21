/**
 * Spend control for the reasoning layer.
 *
 * Every Claude call costs real money — measured, $0.06-0.11 on Opus — and
 * `refresh: true` deliberately bypasses the analysis cache. Without a ceiling,
 * one client in a loop bills indefinitely, so this is the only unbounded spend
 * path in the application.
 *
 * The counter lives in Postgres rather than in this process because each
 * serverless instance has its own memory: an in-process Map would silently
 * multiply the limit by however many instances happen to be warm. See
 * `reserve_analysis` in supabase/schema.sql for why the increment has to be
 * atomic rather than a count-then-insert.
 */

import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * Billed analyses allowed per user per UTC day.
 *
 * Twenty is deliberately generous for real use — a manager needs one per
 * gameweek, plus a few more when they change their squad — while capping
 * worst-case exposure at roughly $2 per user per day. Lower it with
 * ANALYSIS_DAILY_LIMIT rather than editing this.
 */
export const DEFAULT_DAILY_LIMIT = 20;

export function dailyLimit(): number {
  const raw = process.env.ANALYSIS_DAILY_LIMIT;
  if (!raw) return DEFAULT_DAILY_LIMIT;
  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULT_DAILY_LIMIT;
}

export interface Reservation {
  allowed: boolean;
  /** Analyses billed today after this reservation, including it. */
  used: number;
  limit: number;
}

/**
 * Claim one analysis against today's allowance, before spending anything.
 *
 * Fails open. If the counter is unreachable the request proceeds: a database
 * hiccup should not take the product down, and the Anthropic Console spend
 * limit is the real hard stop behind this one.
 */
export async function reserveAnalysis(
  supabase: SupabaseClient,
): Promise<Reservation> {
  const limit = dailyLimit();
  const { data, error } = await supabase.rpc("reserve_analysis");

  if (error || typeof data !== "number") {
    console.error(
      `[rate-limit] could not reserve, allowing the request through: ${
        error?.message ?? "unexpected response"
      }`,
    );
    return { allowed: true, used: 0, limit };
  }

  return { allowed: data <= limit, used: data, limit };
}

/**
 * Hand back a reservation that was never billed — the request was refused, or
 * the Claude call failed. Without this, a failed analysis would still consume
 * allowance the user got nothing for.
 */
export async function releaseAnalysis(
  supabase: SupabaseClient,
): Promise<void> {
  const { error } = await supabase.rpc("release_analysis");
  if (error) {
    console.error(`[rate-limit] could not release a reservation: ${error.message}`);
  }
}
