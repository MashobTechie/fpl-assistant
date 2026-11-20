import Link from "next/link";
import { redirect } from "next/navigation";

import { FdrPill, Tag } from "@/components/ui";
import { createClient } from "@/lib/supabase/server";

/**
 * The pitch, in one screen.
 *
 * The claim that differentiates this product is that the numbers are computed
 * rather than generated, so the hero states the split plainly and the panel
 * beside it shows the machinery rather than describing benefits.
 *
 * The specimen is deliberately anonymous — no player names, no invented
 * returns. It is there to show the voice and the colour system, and a mock-up
 * carrying made-up figures against real footballers would be a worse promise
 * than the one the product actually keeps.
 */

const STATS = [
  { k: "9", l: "legal formations solved", d: "The XI is optimised, not guessed" },
  { k: "600", l: "players projected", d: "Every one, every gameweek" },
  { k: "0", l: "numbers written by AI", d: "The engine computes, Claude explains" },
];

function Specimen() {
  return (
    <div className="relative">
      {/* A glow behind the panel, so it reads as lit rather than pasted on. */}
      <span
        aria-hidden
        className="absolute -inset-6 -z-10 rounded-[2rem] bg-[radial-gradient(60%_60%_at_50%_40%,rgba(0,255,135,0.14),transparent_70%)]"
      />

      <div className="overflow-hidden rounded-panel border border-border bg-surface shadow-[0_1px_0_rgba(255,255,255,0.05)_inset,0_40px_80px_-40px_rgba(0,0,0,0.95)]">
        <span aria-hidden className="pl-rule block h-[3px] w-full" />

        <div className="relative p-6">
          <span
            aria-hidden
            className="absolute bottom-0 left-0 top-0 w-[3px] bg-accent"
          />

          <div className="mb-4 flex items-center gap-2.5">
            <Tag tone="accent" solid>
              Act before the deadline
            </Tag>
            <span className="eyebrow text-[10px] text-ink-faint">Example</span>
          </div>

          <p className="text-balance text-lg font-semibold leading-snug text-accent">
            Make one transfer, and captain the forward with the easiest run of
            fixtures.
          </p>
          <p className="mt-3 text-sm leading-relaxed text-ink-muted">
            One thing to watch: your goalkeeper has not been playing every
            minute, so if he is left out you lose points there.
          </p>
        </div>

        <div className="grid grid-cols-2 gap-px bg-border">
          <div className="bg-surface-2 px-5 py-4">
            <div className="eyebrow text-[9px] text-ink-faint">
              Projected XI
            </div>
            <div className="display mt-1.5 text-3xl text-accent">62.4</div>
          </div>
          <div className="bg-surface-2 px-5 py-4">
            <div className="eyebrow text-[9px] text-ink-faint">Next 5 weeks</div>
            <div className="display mt-1.5 text-3xl text-ink">289</div>
          </div>
        </div>

        <div className="flex items-center gap-2 border-t border-border bg-base px-5 py-4">
          <span className="eyebrow shrink-0 text-[9px] text-ink-faint">
            Fixtures
          </span>
          <div className="flex flex-wrap gap-1.5">
            <FdrPill opponent="BUR" home fdr={2} />
            <FdrPill opponent="LEE" home={false} fdr={2} />
            <FdrPill opponent="BHA" home fdr={3} />
            <FdrPill opponent="ARS" home={false} fdr={5} />
            <FdrPill opponent="EVE" home fdr={2} />
          </div>
        </div>
      </div>
    </div>
  );
}

export default async function Home() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (user) redirect("/dashboard");

  return (
    <>
      <span aria-hidden className="pl-rule block h-[3px] w-full" />

      <main className="mx-auto grid min-h-[calc(100vh-3px)] max-w-6xl items-center gap-14 px-5 py-16 lg:grid-cols-[1.05fr_minmax(0,0.95fr)] lg:gap-16 lg:py-20">
        <div>
          <div className="flex items-center gap-3">
            <span aria-hidden className="h-5 w-[3px] rounded-full bg-accent" />
            <p className="eyebrow text-sm text-accent">FPL Assistant</p>
          </div>

          <h1 className="display mt-5 text-5xl sm:text-6xl lg:text-7xl">
            Expected points,
            <br />
            <span className="text-accent">then the reasoning</span>
            <br />
            behind them.
          </h1>

          <p className="mt-6 max-w-xl text-lg leading-relaxed text-ink-muted">
            Every projection is computed from per-90 expected goals and assists,
            minutes, fixture difficulty and clean-sheet odds — not guessed by a
            language model. The analyst explains the call; the maths makes it.
          </p>

          <div className="mt-9 flex flex-wrap gap-3">
            <Link
              href="/signup"
              className="rounded-lg bg-accent px-6 py-3.5 font-semibold text-base shadow-[0_10px_30px_-12px_var(--color-accent)] transition hover:bg-accent-dim active:translate-y-px"
            >
              Get started
            </Link>
            <Link
              href="/login"
              className="rounded-lg border border-border px-6 py-3.5 font-semibold text-ink-muted transition hover:border-border-bright hover:text-ink"
            >
              Sign in
            </Link>
          </div>

          <dl className="mt-12 grid gap-px overflow-hidden rounded-panel border border-border bg-border sm:grid-cols-3">
            {STATS.map((s) => (
              <div key={s.l} className="bg-surface px-5 py-5">
                <dt className="display text-4xl text-cyan">{s.k}</dt>
                <dd className="mt-2">
                  <span className="eyebrow block text-[10px] text-ink-faint">
                    {s.l}
                  </span>
                  <span className="mt-1.5 block text-sm text-ink-muted">
                    {s.d}
                  </span>
                </dd>
              </div>
            ))}
          </dl>
        </div>

        <Specimen />
      </main>
    </>
  );
}
