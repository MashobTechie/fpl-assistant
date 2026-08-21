import Link from "next/link";
import { redirect } from "next/navigation";

import { createClient } from "@/lib/supabase/server";

/**
 * The pitch, in one screen.
 *
 * The claim that differentiates this product is that the numbers are computed
 * rather than generated, so the hero states the split plainly and the three
 * tiles below show the machinery rather than describing benefits.
 */
export default async function Home() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (user) redirect("/dashboard");

  return (
    <main className="mx-auto flex min-h-screen max-w-3xl flex-col justify-center px-5 py-16">
      <div className="flex items-center gap-3">
        <span aria-hidden className="pl-rule h-6 w-1 rounded-full" />
        <p className="eyebrow text-sm text-[--color-accent]">FPL Assistant</p>
      </div>

      <h1 className="mt-5 font-[family-name:--font-display] text-5xl font-bold uppercase leading-[0.95] tracking-tight sm:text-7xl">
        Expected points,
        <br />
        <span className="text-[--color-accent]">then the reasoning</span>
        <br />
        behind them.
      </h1>

      <p className="mt-6 max-w-xl text-lg leading-relaxed text-[--color-ink-muted]">
        Every projection is computed from per-90 expected goals and assists,
        minutes, fixture difficulty and clean-sheet odds — not guessed by a
        language model. The analyst explains the call; the maths makes it.
      </p>

      <div className="mt-9 flex flex-wrap gap-3">
        <Link
          href="/signup"
          className="rounded-lg bg-[--color-accent] px-6 py-3.5 font-semibold text-[--color-base] transition hover:bg-[--color-accent-dim] active:translate-y-px"
        >
          Get started
        </Link>
        <Link
          href="/login"
          className="rounded-lg border border-[--color-border] px-6 py-3.5 font-semibold text-[--color-ink-muted] transition hover:border-[--color-border-bright] hover:text-[--color-ink]"
        >
          Sign in
        </Link>
      </div>

      <dl className="mt-14 grid gap-px overflow-hidden rounded-2xl border border-[--color-border] bg-[--color-border] sm:grid-cols-3">
        {[
          {
            k: "9",
            l: "legal formations solved",
            d: "The XI is optimised, not guessed",
          },
          {
            k: "600",
            l: "players projected",
            d: "Every one, every gameweek",
          },
          {
            k: "0",
            l: "numbers written by AI",
            d: "The engine computes, Claude explains",
          },
        ].map((s) => (
          <div key={s.l} className="bg-[--color-surface] px-5 py-6">
            <dt className="numeric font-[family-name:--font-display] text-4xl font-bold leading-none text-[--color-cyan]">
              {s.k}
            </dt>
            <dd className="mt-2">
              <span className="eyebrow block text-[10px] text-[--color-ink-faint]">
                {s.l}
              </span>
              <span className="mt-1.5 block text-sm text-[--color-ink-muted]">
                {s.d}
              </span>
            </dd>
          </div>
        ))}
      </dl>
    </main>
  );
}
