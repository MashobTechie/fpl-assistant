import { redirect } from "next/navigation";

import { signOut } from "@/app/auth/actions";
import { DashboardClient } from "@/components/DashboardClient";
import { getBootstrap, resolveTargetGameweek } from "@/lib/fpl/client";
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
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle()
    : { data: null };

  // Deadline context is genuinely useful information, so fetch it server-side
  // rather than making the client wait for a round trip to learn the gameweek.
  const bootstrap = await getBootstrap().catch(() => null);
  const gameweek = bootstrap ? resolveTargetGameweek(bootstrap) : null;
  const deadline =
    bootstrap && gameweek
      ? bootstrap.events.find((e) => e.id === gameweek)?.deadline_time
      : null;

  return (
    <main className="mx-auto max-w-4xl px-4 py-8 sm:px-6 sm:py-10">
      <header className="mb-7">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="min-w-0">
            <div className="flex items-center gap-2.5">
              <span aria-hidden className="pl-rule h-4 w-1 rounded-full" />
              <p className="eyebrow text-[11px] text-[--color-accent]">
                FPL Assistant
              </p>
            </div>
            <h1 className="mt-2.5 font-[family-name:--font-display] text-4xl font-bold uppercase leading-none tracking-tight sm:text-5xl">
              {gameweek ? `Gameweek ${gameweek}` : "Dashboard"}
            </h1>
            {deadline && (
              <p className="mt-2.5 flex flex-wrap items-center gap-2 text-sm text-[--color-ink-muted]">
                <span className="eyebrow rounded bg-[--color-surface-2] px-2 py-1 text-[10px] text-[--color-cyan]">
                  Deadline
                </span>
                <time dateTime={deadline} className="numeric">
                  {new Date(deadline).toLocaleString(undefined, {
                    weekday: "short",
                    day: "numeric",
                    month: "short",
                    hour: "2-digit",
                    minute: "2-digit",
                  })}
                </time>
              </p>
            )}
          </div>
          <form action={signOut}>
            <button
              type="submit"
              className="rounded-lg border border-[--color-border] px-3.5 py-2 text-sm font-medium text-[--color-ink-muted] transition hover:border-[--color-border-bright] hover:text-[--color-ink]"
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
      />
    </main>
  );
}
