"use client";

import { useEffect, useState } from "react";

import type {
  AnalysisResponse,
  GameweekAnalysisLike,
  ProjectionsResponse,
} from "@/lib/types";
import { AnalysisPanel } from "./AnalysisPanel";
import { CaptaincyPanel } from "./CaptaincyPanel";
import { ChipPanel } from "./ChipPanel";
import { LineupTable } from "./LineupTable";
import { PlanPanel } from "./PlanPanel";
import { ReviewPanel } from "./ReviewPanel";
import { PitchView } from "./PitchView";
import { SquadBuilder } from "./SquadBuilder";
import { Button, Card, SectionHeading, SegmentedControl, StatTile } from "./ui";

type Mode = "import" | "manual";
type View = "pitch" | "list";

/**
 * Two requests, not one.
 *
 * The projection engine answers in about two seconds; the analyst takes thirty
 * to ninety because it genuinely reasons first. Waiting on the second to show
 * the first had it backwards — the numbers are the product, and a manager
 * staring at "Analysing…" for a minute cannot tell a slow model from a crash.
 *
 * So the lineup renders as soon as the maths lands, and the written analysis
 * fills in underneath when it arrives. If the analyst fails or the daily
 * allowance is gone, the projections are still there and still useful.
 */
export function DashboardClient({
  initialEntryId,
  savedPicks,
  savedSource,
  savedAnalysis,
  nextGameweek,
  liveGameweek,
}: {
  initialEntryId: number | null;
  /** The last squad this manager saved, restored on load. */
  savedPicks: number[] | null;
  savedSource: "manual" | "fpl_import" | null;
  /** An analysis already paid for. Free to show; never re-requested on load. */
  savedAnalysis: GameweekAnalysisLike | null;
  /** The gameweek whose deadline is next — where decisions can still be made. */
  nextGameweek: number | null;
  /** A gameweek already locked and being played, or null between gameweeks. */
  liveGameweek: number | null;
}) {
  const [mode, setMode] = useState<Mode>(savedSource === "manual" ? "manual" : "import");
  const [entryId, setEntryId] = useState(initialEntryId ? String(initialEntryId) : "");
  const [restoring, setRestoring] = useState(Boolean(savedPicks));
  // Pitch first, like FPL itself: shape is what a manager checks before numbers.
  const [view, setView] = useState<View>("pitch");
  // Default to the gameweek you can still act on. The locked one is offered
  // beside it, because "how is my current team doing" is a fair question too.
  const [gameweek, setGameweek] = useState<number | null>(nextGameweek);

  const [projections, setProjections] = useState<ProjectionsResponse | null>(null);
  const [analysis, setAnalysis] = useState<AnalysisResponse | null>(null);

  const [error, setError] = useState<string | null>(null);
  const [analysisError, setAnalysisError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [thinking, setThinking] = useState(false);

  /**
   * Project a squad for a gameweek. Free, fast, and the actual product — so it
   * runs on load, on submit, and whenever the gameweek changes.
   */
  async function runProjections(
    body: Record<string, unknown>,
    gw: number | null,
  ): Promise<boolean> {
    const res = await fetch("/api/projections", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(gw !== null ? { ...body, gameweek: gw } : body),
    });
    const data = await res.json();
    if (!res.ok) {
      setError(data.error ?? "Something went wrong.");
      // Before a deadline there are no picks to import — steer to manual.
      if (data.code === "picks_unavailable") setMode("manual");
      return false;
    }
    setProjections(data as ProjectionsResponse);
    return true;
  }

  // Restore on load, and re-project whenever the gameweek changes. Projections
  // only: calling /api/analysis here would spend money on every page open, and
  // a stored analysis arrives as a prop instead.
  useEffect(() => {
    if (!savedPicks) return;
    let cancelled = false;

    (async () => {
      try {
        const res = await fetch("/api/projections", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            playerIds: savedPicks,
            ...(gameweek !== null ? { gameweek } : {}),
          }),
        });
        const data = await res.json();
        if (!cancelled && res.ok) setProjections(data as ProjectionsResponse);
      } catch {
        // A failed restore is not worth an error banner: the squad is still
        // saved, and the manager can re-run it.
      } finally {
        if (!cancelled) setRestoring(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [savedPicks, gameweek]);

  /**
   * Switching gameweek re-projects the squad already on screen. The analysis
   * is cleared rather than carried over: it reasons about one gameweek's
   * numbers and would be quietly wrong against another's.
   */
  function changeGameweek(gw: number) {
    setGameweek(gw);
    setAnalysis(null);
    setAnalysisError(null);
    const picks =
      projections?.squad.map((p) => p.playerId) ?? savedPicks ?? null;
    if (!picks) return;
    setPending(true);
    void runProjections({ playerIds: picks }, gw).finally(() =>
      setPending(false),
    );
  }

  /** Phase two on its own, so a restored squad can ask for an analysis. */
  async function runAnalysis(body: Record<string, unknown>) {
    setThinking(true);
    setAnalysisError(null);
    try {
      const res = await fetch("/api/analysis", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(
          gameweek !== null ? { ...body, gameweek } : body,
        ),
      });
      const data = await res.json();
      if (!res.ok) {
        setAnalysisError(data.error ?? "The analyst could not be reached.");
        return;
      }
      setAnalysis(data as AnalysisResponse);
    } catch {
      setAnalysisError("Lost the connection while the analyst was working.");
    } finally {
      setThinking(false);
    }
  }

  async function run(body: Record<string, unknown>) {
    setPending(true);
    setError(null);
    setAnalysisError(null);
    setProjections(null);
    setAnalysis(null);

    let ok = false;
    try {
      ok = await runProjections(body, gameweek);
    } catch {
      setError("Couldn't reach the server. Check your connection and try again.");
      return;
    } finally {
      setPending(false);
    }
    if (!ok) return;

    await runAnalysis(body);
  }

  // The freshly fetched analysis wins; otherwise fall back to the stored one.
  const shownAnalysis = analysis?.analysis ?? savedAnalysis?.analysis ?? null;

  return (
    <div className="flex flex-col gap-6">
      <Card accent className="p-5 sm:p-6">
        <SectionHeading hint={projections ? `GW${projections.gameweek}` : undefined}>
          Your squad
        </SectionHeading>

        <div className="mb-5 flex flex-wrap gap-3">
          <SegmentedControl
            value={mode}
            onChange={setMode}
            options={[
              { value: "import", label: "Import by FPL ID" },
              { value: "manual", label: "Build manually" },
            ]}
          />

          {/* Only meaningful while a gameweek is locked and being played. The
              rest of the week there is one answer and no choice to offer. */}
          {liveGameweek !== null && nextGameweek !== null && (
            <SegmentedControl
              value={String(gameweek ?? nextGameweek)}
              onChange={(v) => changeGameweek(Number(v))}
              options={[
                { value: String(liveGameweek), label: `GW${liveGameweek} · locked` },
                { value: String(nextGameweek), label: `GW${nextGameweek} · next` },
              ]}
            />
          )}
        </div>

        {liveGameweek !== null && gameweek === liveGameweek && (
          <p className="mb-4 rounded-lg border border-[--color-cyan]/30 bg-[--color-cyan]/10 px-3.5 py-2.5 text-sm text-[--color-ink-muted]">
            Gameweek {liveGameweek} is already locked, so nothing here can be
            changed — this is what your team is projected to score.
          </p>
        )}

        {mode === "import" ? (
          <form
            onSubmit={(e) => {
              e.preventDefault();
              const id = Number(entryId);
              if (!Number.isInteger(id) || id <= 0) {
                setError("Enter a valid FPL team ID — digits only.");
                return;
              }
              void run({ entryId: id });
            }}
            className="flex flex-col gap-3"
          >
            <label htmlFor="entryId" className="eyebrow text-[11px] text-[--color-ink-faint]">
              FPL team ID
              <span className="ml-1.5 font-normal normal-case tracking-normal">
                — the number in your points-page URL
              </span>
            </label>
            <div className="flex gap-2">
              <input
                id="entryId"
                inputMode="numeric"
                value={entryId}
                onChange={(e) => setEntryId(e.target.value.replace(/\D/g, ""))}
                placeholder="1234567"
                className="numeric min-w-0 flex-1 rounded-lg border border-[--color-border] bg-[--color-base] px-3.5 py-3 text-lg font-semibold outline-none transition focus:border-[--color-cyan]"
              />
              <Button type="submit" disabled={pending || !entryId} className="shrink-0">
                {pending ? "Projecting…" : "Analyse"}
              </Button>
            </div>
          </form>
        ) : (
          <SquadBuilder pending={pending} onSubmit={(playerIds) => void run({ playerIds })} />
        )}

        {error && (
          <p
            role="alert"
            className="mt-4 rounded-lg border border-[--color-pink]/40 bg-[--color-pink]/10 px-3.5 py-3 text-sm leading-relaxed text-[--color-pink]"
          >
            {error}
          </p>
        )}
      </Card>

      {projections && (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <StatTile
            label="Squad value"
            value={
              projections.squadValue !== null
                ? `£${projections.squadValue.toFixed(1)}m`
                : "—"
            }
          />
          <StatTile
            label="Bank"
            value={projections.bank !== null ? `£${projections.bank.toFixed(1)}m` : "—"}
          />
          <StatTile
            label={`GW${projections.gameweek} projected`}
            value={projections.optimal.expectedPoints.toFixed(1)}
            tone="accent"
            sub={projections.optimal.formationLabel}
          />
          <StatTile
            label={`Next ${projections.horizon} GW`}
            value={projections.optimal.startingXI
              .reduce((sum, p) => sum + p.totalExpectedPoints, 0)
              .toFixed(0)}
            sub="starting XI"
          />
        </div>
      )}

      {projections && (
        <Card className="p-4 sm:p-6">
          <SectionHeading
            hint={`${projections.optimal.formationLabel} · ${projections.optimal.expectedPoints.toFixed(1)} xPts`}
          >
            Projected lineup
          </SectionHeading>

          <div className="mb-4">
            <SegmentedControl
              value={view}
              onChange={setView}
              options={[
                { value: "pitch", label: "Pitch" },
                { value: "list", label: "List" },
              ]}
            />
          </div>

          {view === "pitch" ? (
            <PitchView
              startingXI={projections.optimal.startingXI}
              bench={projections.optimal.bench}
              gameweek={projections.gameweek}
              formationLabel={projections.optimal.formationLabel}
              expectedPoints={projections.optimal.expectedPoints}
              captainId={shownAnalysis?.captain.playerId}
              viceId={shownAnalysis?.viceCaptain.playerId}
            />
          ) : (
            <LineupTable
              startingXI={projections.optimal.startingXI}
              bench={projections.optimal.bench}
              gameweek={projections.gameweek}
              horizon={projections.horizon}
              captainId={shownAnalysis?.captain.playerId}
              viceId={shownAnalysis?.viceCaptain.playerId}
            />
          )}
        </Card>
      )}

      {projections && projections.captaincy.length > 0 && (
        <CaptaincyPanel
          candidates={projections.captaincy}
          gameweek={projections.gameweek}
        />
      )}

      {projections && <PlanPanel plan={projections.plan} />}

      {/* Order is this week, then the horizon, then what already happened:
          captaincy and the plan are decisions, the review is context. */}
      {projections && (
        <ChipPanel
          chips={projections.chips}
          transfers={projections.transfers}
          gameweek={projections.gameweek}
        />
      )}

      {projections?.review && <ReviewPanel review={projections.review} />}

      {restoring && !projections && (
        <Card className="p-5">
          <p className="text-sm text-[--color-ink-muted]">
            Restoring your saved squad…
          </p>
        </Card>
      )}

      {thinking && <AnalystProgress />}

      {analysisError && !thinking && (
        <Card className="p-5">
          <p role="alert" className="text-sm leading-relaxed text-[--color-pink]">
            {analysisError}
          </p>
          <p className="mt-2 text-sm text-[--color-ink-muted]">
            The projections above are unaffected — they are computed here, not by
            the analyst.
          </p>
        </Card>
      )}

      {!analysis && !thinking && savedAnalysis && projections && (
        <AnalysisPanel
          analysis={savedAnalysis.analysis}
          gameweek={savedAnalysis.gameweek}
          optimalPoints={projections.optimal.expectedPoints}
          formation={projections.optimal.formationLabel}
          cached
          generatedAt={savedAnalysis.created_at}
        />
      )}

      {analysis && projections && (
        <AnalysisPanel
          analysis={analysis.analysis}
          gameweek={analysis.gameweek}
          optimalPoints={projections.optimal.expectedPoints}
          formation={projections.optimal.formationLabel}
          cached={analysis.cached}
          generatedAt={analysis.generatedAt}
        />
      )}

      {/* One control, always reachable once projections exist. Previously a
          restored analysis hid the "get one" button while never showing the
          "regenerate" one, which left no way to re-run a squad at all. */}
      {projections && !thinking && (
        <div className="flex flex-wrap items-center gap-3">
          <Button
            onClick={() =>
              void runAnalysis({
                ...(mode === "import" && entryId
                  ? { entryId: Number(entryId) }
                  : { playerIds: projections.squad.map((p) => p.playerId) }),
                // Force a fresh call only when something is already on screen.
                // Otherwise the cache is exactly what we want to hit, for free.
                refresh: Boolean(shownAnalysis),
              })
            }
          >
            {shownAnalysis ? "Re-run the analysis" : "Get the analyst's read"}
          </Button>
          {shownAnalysis && (
            <span className="text-xs text-[--color-ink-muted]">
              Uses one analysis from today&apos;s allowance.
            </span>
          )}
        </div>
      )}

    </div>
  );
}

/**
 * An honest wait.
 *
 * A spinner with no duration reads as broken after about fifteen seconds. This
 * counts up and says what is happening, because the wait is real and the reason
 * for it is defensible: the model is reasoning, not hanging.
 */
function AnalystProgress() {
  const [seconds, setSeconds] = useState(0);

  // Date.now() belongs in the effect, not the render pass: React treats reading
  // the clock while rendering as impure, and it is.
  useEffect(() => {
    const started = Date.now();
    const t = setInterval(
      () => setSeconds(Math.round((Date.now() - started) / 1000)),
      1000,
    );
    return () => clearInterval(t);
  }, []);

  return (
    <Card className="p-5">
      <div className="flex items-center gap-3">
        <span
          aria-hidden
          className="h-2 w-2 shrink-0 animate-pulse rounded-full bg-[--color-cyan]"
        />
        <p className="text-sm font-semibold text-[--color-ink]">
          The analyst is reading your projections
        </p>
        <span className="numeric ml-auto text-sm font-bold text-[--color-cyan]">
          {seconds}s
        </span>
      </div>
      <p className="mt-2 text-sm leading-relaxed text-[--color-ink-muted]">
        {seconds < 30
          ? "Usually 30–90 seconds. It reasons through captaincy, bench order and risks before answering."
          : "Still working. Longer squads and tighter calls take more thinking."}
      </p>
      <div
        className="mt-3 h-1 overflow-hidden rounded-full bg-[--color-surface-3]"
        role="progressbar"
        aria-label="Analysis progress"
      >
        <div
          className="pl-rule h-full transition-[width] duration-1000 ease-linear"
          style={{ width: `${Math.min(95, (seconds / 60) * 100)}%` }}
        />
      </div>
    </Card>
  );
}
