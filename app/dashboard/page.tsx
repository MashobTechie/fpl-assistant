import { redirect } from "next/navigation";

import { signOut } from "@/app/auth/actions";
import { DashboardClient } from "@/components/DashboardClient";
import { getBootstrap, resolveTargetGameweek } from "@/lib/fpl/client";
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

  // Deadline context is genuinely useful information, so fetch it server-side
  // rather than making the client wait for a round trip to learn the gameweek.
  const bootstrap = await getBootstrap().catch(() => null);
  const gameweek = bootstrap ? resolveTargetGameweek(bootstrap) : null;
  const deadline =
    bootstrap && gameweek
      ? bootstrap.events.find((e) => e.id === gameweek)?.deadline_time
      : null;

  return (
    <main className="mx-auto max-w-4xl px-4 py-8 sm:px-6">
      <header className="mb-6 flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-xs font-semibold tracking-widest text-[--color-accent]">
            FPL ASSISTANT
          </p>
          <h1 className="mt-1 text-2xl font-bold">
            {gameweek ? `Gameweek ${gameweek}` : "Dashboard"}
          </h1>
          {deadline && (
            <p className="mt-0.5 text-sm text-[--color-ink-muted]">
              Deadline{" "}
              <time dateTime={deadline}>
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
            className="rounded-lg border border-[--color-border] px-3 py-1.5 text-sm text-[--color-ink-muted] transition hover:text-[--color-ink]"
          >
            Sign out
          </button>
        </form>
      </header>

      <DashboardClient initialEntryId={profile?.fpl_entry_id ?? null} />
    </main>
  );
}
