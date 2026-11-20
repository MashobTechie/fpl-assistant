import { redirect } from "next/navigation";

import { signOut } from "@/app/auth/actions";
import { DashboardClient } from "@/components/DashboardClient";
import { Tag } from "@/components/ui";
import { getBootstrap, resolveTargetGameweek } from "@/lib/fpl/client";
import { PROJECTION_ENGINE_VERSION } from "@/lib/projections/constants";
import { squadHash } from "@/lib/squad/validate";
import { createClient } from "@/lib/supabase/server";

export default async function DashboardPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: profile } = await supabase
    .from("profiles")
    .select("fpl_entry_id")
    .eq("id", user.id)
    .maybeSingle();

  // Restore whatever this manager last worked on.
  //
  // The squad was always being saved; nothing ever read it back, so a refresh
  // silently dropped a squad someone had just spent minutes building.
  const { data: savedSquad } = await supabase
    .from("squads")
    .select("picks, gameweek, source, fpl_entry_id")
    .eq("user_id", user.id)
    .order("gameweek", { ascending: false })
    .limit(1)
    .maybeSingle();

  const picks: number[] = Array.isArray(savedSquad?.picks)
    ? (savedSquad.picks as number[])
    : [];

  // Any analysis already paid for is free to show again. Deliberately read here
  // rather than by calling /api/analysis on mount, which would bill the user
  // once per page load.
  const { data: savedAnalysis } = picks.length
    ? await supabase
        .from("analyses")
        .select("analysis, gameweek, horizon, created_at")
        .eq("user_id", user.id)
        .eq("squad_hash", squadHash(picks))
        // An analysis from an older engine describes numbers this build no longer
        // produces. Better to offer a fresh one than to restore a stale reading.
        .eq("engine_version", PROJECTION_ENGINE_VERSION)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle()
    : { data: null };

  // Deadline context is genuinely useful information, so fetch it server-side
  // rather than making the client wait for a round trip to learn the gameweek.
  const bootstrap = await getBootstrap().catch(() => null);
  const gameweek = bootstrap ? resolveTargetGameweek(bootstrap) : null;

  // Once a deadline passes, that gameweek is locked and the next one is where
  // decisions live — so the app moves on. It was doing that silently, which
  // reads as a bug: you lock a squad and the screen jumps to a week you have
  // not thought about yet. Both are offered instead, labelled.
  const liveGameweek =
    bootstrap?.events.find((e) => e.is_current && !e.finished)?.id ?? null;
  const deadline =
    bootstrap && gameweek
      ? bootstrap.events.find((e) => e.id === gameweek)?.deadline_time
      : null;

  return (
    <div className="min-h-screen pb-16">
      {/* The league's rule across the very top of the page. One per screen,
          and this is the screen's. */}
      <span aria-hidden className="pl-rule block h-[3px] w-full" />

      {/* The title card. The scoreboard below it carries the countdown, so this
          carries the absolute date — the two answer different questions and a
          manager asks both: "how long have I got" and "which evening is it". */}
      <header className="mx-auto max-w-5xl px-4 pb-6 pt-7 sm:px-6 sm:pb-8 sm:pt-9">
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0">
            <div className="flex items-center gap-2.5">
              <span
                aria-hidden
                className="h-3.5 w-[3px] rounded-full bg-accent"
              />
              <p className="eyebrow text-[11px] text-accent">FPL Assistant</p>
            </div>

            <h1 className="display mt-3 text-5xl sm:text-7xl">
              {gameweek ? (
                <>
                  <span className="text-ink-faint">Gameweek </span>
                  <span className="text-ink">{gameweek}</span>
                </>
              ) : (
                "Dashboard"
              )}
            </h1>

            {deadline && (
              <p className="mt-4 flex flex-wrap items-center gap-2.5 text-sm text-ink-muted">
                <Tag tone="info">Deadline</Tag>
                <time dateTime={deadline} className="numeric font-semibold text-ink">
                  {new Date(deadline).toLocaleString(undefined, {
                    weekday: "long",
                    day: "numeric",
                    month: "short",
                    hour: "2-digit",
                    minute: "2-digit",
                  })}
                </time>
              </p>
            )}

            {liveGameweek !== null && (
              <p className="mt-3 max-w-prose text-sm leading-relaxed text-ink-faint">
                Gameweek {liveGameweek} is locked and under way — this is your
                next deadline.
              </p>
            )}
          </div>

          <form action={signOut}>
            <button
              type="submit"
              className="rounded-lg border border-border px-3.5 py-2 text-sm font-medium text-ink-muted transition hover:border-border-bright hover:text-ink"
            >
              Sign out
            </button>
          </form>
        </div>
      </header>

      <DashboardClient
        initialEntryId={profile?.fpl_entry_id ?? savedSquad?.fpl_entry_id ?? null}
        savedPicks={picks.length ? picks : null}
        savedSource={(savedSquad?.source as "manual" | "fpl_import") ?? null}
        savedAnalysis={savedAnalysis ?? null}
        nextGameweek={gameweek}
        liveGameweek={liveGameweek}
        deadline={deadline ?? null}
      />
    </div>
  );
}
