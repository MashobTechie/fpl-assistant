"use client";

import { useEffect, useState } from "react";

import {
  forgetDraft,
  recallDraft,
  rememberDraft,
} from "@/lib/draft-session";
import type { TransferChip } from "@/lib/squad/draft";
import type {
  AnalysisResponse,
  GameweekAnalysisLike,
  ProjectionsResponse,
  SavedDraft,
  SavedDraftsResponse,
} from "@/lib/types";
import { AnalysisPanel } from "./AnalysisPanel";
import { CaptaincyPanel } from "./CaptaincyPanel";
import { ChipPanel } from "./ChipPanel";
import { LineupTable } from "./LineupTable";
import { PlanPanel } from "./PlanPanel";
import { ReviewPanel } from "./ReviewPanel";
import { SavedDrafts } from "./SavedDrafts";
import { DraftVerdict } from "./DraftVerdict";
import { PitchView } from "./PitchView";
import { TransferSandbox, type Incoming } from "./TransferSandbox";
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
  // ---- Transfer drafts ----------------------------------------------------
  // The real squad is kept aside while a draft is on screen, so "back to my
  // squad" is instant and never re-fetches, and nothing about a draft is saved.
  const [sandbox, setSandbox] = useState(false);
  const [baseline, setBaseline] = useState<ProjectionsResponse | null>(null);
  const [draftMoves, setDraftMoves] = useState<{ out: number; in: number }[] | null>(null);
  const [checkingDraft, setCheckingDraft] = useState(false);
  const [draftError, setDraftError] = useState<string | null>(null);
  const [sandboxSeed, setSandboxSeed] = useState<Map<number, Incoming> | undefined>();
  const [sandboxChip, setSandboxChip] = useState<TransferChip | null>(null);
  // A planned move the manager asked to try, by id. The sandbox resolves it
  // against the player list, which is where the price and club come from.
  const [sandboxPlanned, setSandboxPlanned] =
    useState<{ out: number; in: number }[] | undefined>();
  // Kept beside the moves so a re-analysis asks the same question: the same
  // fifteen on a wildcard and off it are different decisions.
  const [draftChip, setDraftChip] = useState<TransferChip | null>(null);
  // ---- Saved drafts -------------------------------------------------------
  // Stored as the swaps, never the fifteen they produce and never the verdict:
  // both are recomputed on open, because prices move daily and the engine that
  // recomputes them is free.
  const [savedDrafts, setSavedDrafts] = useState<SavedDraft[]>([]);
  const [savingDraft, setSavingDraft] = useState(false);
  const [saveDraftError, setSaveDraftError] = useState<string | null>(null);
  const [savedAs, setSavedAs] = useState<string | null>(null);
  const [draftBusyId, setDraftBusyId] = useState<string | null>(null);
  const [analysis, setAnalysis] = useState<AnalysisResponse | null>(null);

  const [error, setError] = useState<string | null>(null);
  const [analysisError, setAnalysisError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [thinking, setThinking] = useState(false);

  /**
   * How to ask for this manager's squad.
   *
   * An imported squad goes by its FPL id, always. Sending its picks as a manual
   * fifteen instead prices them against the £100m ceiling at today's prices —
   * rejecting any squad that has risen in value — and drops the review, chips
   * and free-transfer count, all of which need the id. That was fixed for the
   * gameweek switcher and left in place here, where it ran on every page load.
   */
  function squadBody(picks?: number[] | null): Record<string, unknown> | null {
    if (mode === "import" && entryId) return { entryId: Number(entryId) };
    const ids = picks ?? projections?.squad.map((p) => p.playerId) ?? savedPicks;
    return ids && ids.length ? { playerIds: ids } : null;
  }

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

  // Restore on load. Projections only: calling /api/analysis here would spend
  // money on every page open, and a stored analysis arrives as a prop instead.
  //
  // Mount only. The gameweek switcher re-projects itself, so depending on
  // `gameweek` here fired a second identical request on every switch and let
  // whichever response arrived last win.
  useEffect(() => {
    if (!savedPicks) return;
    let cancelled = false;

    (async () => {
      try {
        const body = squadBody(savedPicks);
        if (!body) return;
        const res = await fetch("/api/projections", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            ...body,
            ...(gameweek !== null ? { gameweek } : {}),
          }),
        });
        const data = await res.json();
        if (cancelled || !res.ok) return;
        setProjections(data as ProjectionsResponse);

        // A draft someone was part-way through judging when the tab reloaded.
        // Re-checked rather than restored from storage: the stored thing is
        // the question, and the answer has to come from today's prices.
        const kept = recallDraft();
        const sameSquad =
          kept &&
          (entryId
            ? kept.entryId === Number(entryId)
            : kept.playerIds?.length === savedPicks.length &&
              kept.playerIds.every((id) => savedPicks.includes(id)));
        if (kept && sameSquad && kept.gameweek === (data as ProjectionsResponse).gameweek) {
          void checkDraft(kept.transfers, kept.chip, { silent: true });
        }
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
    // Mount only, deliberately — see above. Listing the values it reads would
    // re-run a restore on every gameweek switch, which is the request this
    // change removed.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ---- Saved drafts -------------------------------------------------------

  /** The drafts kept for this gameweek, for either kind of squad. */
  async function loadSavedDrafts(gw: number | null) {
    if (gw === null) return;
    try {
      const res = await fetch(`/api/drafts?gameweek=${gw}`);
      if (!res.ok) return;
      const data = (await res.json()) as SavedDraftsResponse;
      setSavedDrafts(data.drafts ?? []);
    } catch {
      // A list that will not load is not worth an error banner; the drafts are
      // still there and the next load will show them.
    }
  }

  // Fetched rather than cleared: the list is filtered by gameweek where it is
  // rendered, so there is no stale state to wipe and nothing to set before the
  // request comes back.
  useEffect(() => {
    if (gameweek === null) return;
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`/api/drafts?gameweek=${gameweek}`);
        if (!res.ok) return;
        const data = (await res.json()) as SavedDraftsResponse;
        if (!cancelled) setSavedDrafts(data.drafts ?? []);
      } catch {
        // See above: a missing list is not an error worth showing.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [gameweek, entryId]);

  /** Keep the draft on screen under a name, so it outlives the session. */
  async function saveDraft(name: string) {
    if (!draftMoves || gameweek === null) return;
    setSavingDraft(true);
    setSaveDraftError(null);
    try {
      const res = await fetch("/api/drafts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          gameweek,
          name,
          transfers: draftMoves,
          chip: draftChip,
          // Recorded when there is one, so a draft can be told apart from one
          // built against a different team. A manual squad simply has none.
          entryId: entryId ? Number(entryId) : null,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setSaveDraftError(data.error ?? "That draft could not be saved.");
        return;
      }
      setSavedAs(name);
      await loadSavedDrafts(gameweek);
    } catch {
      setSaveDraftError("Couldn't reach the server. Try again.");
    } finally {
      setSavingDraft(false);
    }
  }

  /** Re-check a saved draft against today's prices and today's projections. */
  async function openSavedDraft(draft: SavedDraft) {
    setDraftBusyId(draft.id);
    try {
      const ok = await checkDraft(draft.transfers, draft.chip);
      if (ok) setSavedAs(draft.name);
    } finally {
      setDraftBusyId(null);
    }
  }

  async function deleteSavedDraft(draft: SavedDraft) {
    setDraftBusyId(draft.id);
    try {
      const res = await fetch(`/api/drafts?id=${encodeURIComponent(draft.id)}`, {
        method: "DELETE",
      });
      if (res.ok) {
        setSavedDrafts((list) => list.filter((d) => d.id !== draft.id));
        if (savedAs === draft.name) setSavedAs(null);
      }
    } catch {
      // Nothing useful to say: the row is still listed and still deletable.
    } finally {
      setDraftBusyId(null);
    }
  }

  /**
   * Switching gameweek re-projects the squad already on screen. The analysis
   * is cleared rather than carried over: it reasons about one gameweek's
   * numbers and would be quietly wrong against another's.
   */
  function changeGameweek(gw: number) {
    setGameweek(gw);
    setAnalysis(null);
    setAnalysisError(null);
    // A draft belongs to one deadline; switching gameweek drops it.
    const real = baseline ?? projections;
    if (baseline) setProjections(baseline);
    setBaseline(null);
    setDraftMoves(null);
    setDraftChip(null);
    setSavedAs(null);
    setSandbox(false);
    // A draft belongs to one deadline, so it does not survive the switch.
    forgetDraft();

    // The real squad's picks, not the draft's: `projections` is the draft
    // while one is on screen, and switching gameweek must not carry its moves
    // into a week they were never proposed for.
    const body = squadBody(real?.squad.map((p) => p.playerId) ?? savedPicks);
    if (!body) return;
    setPending(true);
    void runProjections(body, gw).finally(() => setPending(false));
  }

  /**
   * Ask the server whether a draft can really be made, and what it is worth.
   *
   * The sandbox's own running total is an estimate; this is the authority. On
   * success the draft replaces the squad on screen — so the pitch, captaincy
   * and plan all describe the team you would have — and the analyst is asked
   * straight away, because a verdict is what the button promised.
   */
  async function checkDraft(
    transfers: { out: number; in: number }[],
    chip: TransferChip | null,
    /**
     * `analyse` spends money, so it is opt-in. The sandbox button promises a
     * written verdict and asks for one; restoring a draft after a reload, or
     * reopening a saved one, must not bill for a page load nobody asked to pay
     * for. The analyst is one click away either way.
     *
     * `silent` suppresses the error banner, for a restore the manager did not
     * ask for: a draft whose player has since been transferred out in the real
     * app should disappear quietly, not greet them with a failure.
     */
    opts: { analyse?: boolean; silent?: boolean } = {},
  ): Promise<boolean> {
    const { analyse = false, silent = false } = opts;
    // The real squad, not the one on screen: `projections` is the draft while
    // one is open, and swaps re-applied to a draft would compound.
    const real = baseline ?? projections;
    const squad = squadBody(real?.squad.map((p) => p.playerId));
    if (!squad) return false;

    setCheckingDraft(true);
    setDraftError(null);
    try {
      const body = {
        ...squad,
        transfers,
        ...(chip ? { chip } : {}),
        ...(gameweek !== null ? { gameweek } : {}),
      };
      const res = await fetch("/api/projections", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (!res.ok) {
        if (silent) forgetDraft();
        else setDraftError(data.error ?? "That draft could not be checked.");
        return false;
      }
      setBaseline((b) => b ?? projections);
      setProjections(data as ProjectionsResponse);
      setDraftMoves(transfers);
      setDraftChip(chip);
      setSandbox(false);
      setSavedAs(null);
      setSaveDraftError(null);
      setAnalysis(null);
      setAnalysisError(null);
      // Survives a reload. The question is stored, never the verdict — which
      // is why the restore above re-checks rather than redisplaying.
      rememberDraft({
        gameweek: (data as ProjectionsResponse).gameweek,
        entryId: "entryId" in squad ? (squad.entryId as number) : null,
        playerIds: "playerIds" in squad ? (squad.playerIds as number[]) : null,
        transfers,
        chip,
      });
      if (analyse) {
        void runAnalysis({ ...squad, transfers, ...(chip ? { chip } : {}) });
      }
      return true;
    } catch {
      if (!silent) {
        setDraftError("Couldn't reach the server. Check your connection and try again.");
      }
      return false;
    } finally {
      setCheckingDraft(false);
    }
  }

  function leaveDraft() {
    if (baseline) setProjections(baseline);
    setBaseline(null);
    setDraftMoves(null);
    setDraftChip(null);
    setSavedAs(null);
    setSaveDraftError(null);
    forgetDraft();
    setAnalysis(null);
    setAnalysisError(null);
    setDraftError(null);
  }

  /**
   * Whether transfers can be tried at all.
   *
   * Both kinds of squad can be, now that they are priced differently rather
   * than one of them being refused: an imported squad against FPL's own bank
   * and selling prices, a manual one against what is left of the £100m. What
   * it still needs is a squad on screen and a deadline that has not passed —
   * a locked gameweek has nothing left to transfer for.
   *
   * Computed once because several places offer the sandbox, and a gate
   * enforced in one of them is not a gate.
   */
  const canDraft =
    Boolean(projections) &&
    !projections?.draft &&
    (mode === "import" ? Boolean(entryId) : Boolean(projections?.squad.length)) &&
    (liveGameweek === null || gameweek !== liveGameweek);

  /** Open the sandbox with a move already on the pitch. */
  function trySandbox(transfers?: { out: number; in: number }[]) {
    setSandboxSeed(undefined);
    setSandboxChip(null);
    setSandboxPlanned(transfers);
    setSandbox(true);
  }

  function editDraft() {
    const d = projections?.draft;
    setSandboxPlanned(undefined);
    setSandboxChip(d?.chip ?? null);
    setSandboxSeed(
      d
        ? new Map(
            d.moves.map((m) => [
              m.out.playerId,
              { id: m.in.playerId, name: m.in.name, team: m.in.team, cost: m.in.price },
            ]),
          )
        : undefined,
    );
    leaveDraft();
    setSandbox(true);
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
    // A fresh import or build replaces everything, drafts included.
    setBaseline(null);
    setDraftMoves(null);
    setSandbox(false);
    setDraftError(null);
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

      {projections?.draft && (
        <DraftVerdict
          draft={projections.draft}
          horizon={projections.horizon}
          onBack={leaveDraft}
          onEdit={editDraft}
          // Keeping it needs a gameweek to file it under; the FPL id is
          // recorded when there is one but a manual draft saves without.
          save={
            gameweek !== null
              ? {
                  onSave: (name) => void saveDraft(name),
                  saving: savingDraft,
                  error: saveDraftError,
                  savedAs,
                }
              : undefined
          }
        />
      )}

      {projections && sandbox && (
        <Card accent className="p-4 sm:p-6">
          <SectionHeading hint={`GW${projections.gameweek} deadline`}>
            Try transfers
          </SectionHeading>
          <TransferSandbox
            projections={projections}
            checking={checkingDraft}
            error={draftError}
            onCheck={(t, c) => void checkDraft(t, c, { analyse: true })}
            onClose={() => {
              setSandbox(false);
              setDraftError(null);
              setSandboxSeed(undefined);
              setSandboxChip(null);
              setSandboxPlanned(undefined);
            }}
            initialMoves={sandboxSeed}
            initialTransfers={sandboxPlanned}
            initialChip={sandboxChip}
          />
        </Card>
      )}

      {projections && !sandbox && (
        <Card className="p-4 sm:p-6">
          <SectionHeading
            hint={`${projections.optimal.formationLabel} · ${projections.optimal.expectedPoints.toFixed(1)} xPts`}
          >
            {projections.draft ? "Lineup with your draft" : "Projected lineup"}
          </SectionHeading>

          <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
            {/* Transfers can only be tried on an imported squad — that is the
                only one with a real bank and selling prices to check against —
                and only for a deadline that has not passed. */}
            {canDraft && (
              <button
                type="button"
                onClick={() => trySandbox()}
                className="order-last rounded-lg bg-[--color-cyan]/15 px-3.5 py-2 text-sm font-semibold text-[--color-cyan] ring-1 ring-[--color-cyan]/40 transition hover:bg-[--color-cyan]/25 sm:order-none"
              >
                Try transfers
              </button>
            )}
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

      {projections && (
        <PlanPanel
          plan={projections.plan}
          // The plan is already solved; re-finding its two names in the picker
          // by hand is busywork, so the move loads straight into the sandbox.
          onTry={canDraft ? (t) => trySandbox([t]) : undefined}
        />
      )}

      {/* Beside the plan, because both answer the same question, and hidden
          while a draft is open — the verdict on screen is the draft itself. */}
      {projections && !sandbox && !projections.draft && gameweek !== null && (
        <SavedDrafts
          drafts={savedDrafts}
          gameweek={gameweek}
          busyId={draftBusyId}
          onLoad={(d) => void openSavedDraft(d)}
          onDelete={(d) => void deleteSavedDraft(d)}
        />
      )}

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
                  ? {
                      entryId: Number(entryId),
                      // A draft is re-analysed as a draft, not as the squad
                      // it replaced.
                      ...(draftMoves ? { transfers: draftMoves } : {}),
                      ...(draftChip ? { chip: draftChip } : {}),
                    }
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
