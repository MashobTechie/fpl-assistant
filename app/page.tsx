import Link from "next/link";
import { redirect } from "next/navigation";

import { createClient } from "@/lib/supabase/server";

export default async function Home() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (user) redirect("/dashboard");

  return (
    <main className="mx-auto flex min-h-screen max-w-2xl flex-col justify-center px-5 py-16">
      <p className="text-sm font-semibold tracking-widest text-[--color-accent]">
        FPL ASSISTANT
      </p>
      <h1 className="mt-3 text-4xl font-bold leading-tight sm:text-5xl">
        Expected points, then the reasoning behind them.
      </h1>
      <p className="mt-4 text-lg leading-relaxed text-[--color-ink-muted]">
        Every projection is computed from per-90 expected goals and assists,
        minutes, fixture difficulty and clean-sheet odds — not guessed by a
        language model. The analyst explains the call; the maths makes it.
      </p>
      <div className="mt-8 flex flex-wrap gap-3">
        <Link
          href="/signup"
          className="rounded-lg bg-[--color-accent] px-5 py-3 font-semibold text-[--color-base] transition hover:bg-[--color-accent-dim]"
        >
          Get started
        </Link>
        <Link
          href="/login"
          className="rounded-lg border border-[--color-border] px-5 py-3 font-semibold text-[--color-ink-muted] transition hover:text-[--color-ink]"
        >
          Sign in
        </Link>
      </div>
    </main>
  );
}
