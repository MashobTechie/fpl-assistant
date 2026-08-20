"use client";

import { useState } from "react";

import type { AnalysisResponse } from "@/lib/types";
import { AnalysisPanel } from "./AnalysisPanel";
import { LineupTable } from "./LineupTable";
import { SquadBuilder } from "./SquadBuilder";
import { Card, SectionHeading } from "./ui";

type Mode = "import" | "manual";

export function DashboardClient({ initialEntryId }: { initialEntryId: number | null }) {
  const [mode, setMode] = useState<Mode>("import");
  const [entryId, setEntryId] = useState(initialEntryId ? String(initialEntryId) : "");
  const [result, setResult] = useState<AnalysisResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function analyse(body: Record<string, unknown>) {
    setPending(true);
    setError(null);
    try {
      const res = await fetch("/api/analysis", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? "Something went wrong.");
        // Before a deadline there are no picks to import — steer to manual.
        if (data.code === "picks_unavailable") setMode("manual");
        return;
      }
      setResult(data as AnalysisResponse);
    } catch {
      setError("Couldn't reach the server. Check your connection and try again.");
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="flex flex-col gap-6">
      <Card className="p-5">
        <SectionHeading hint={result ? `GW${result.gameweek}` : undefined}>
          Your squad
        </SectionHeading>

        <div className="mb-4 flex gap-2">
          {(["import", "manual"] as const).map((m) => (
            <button
              key={m}
              type="button"
              onClick={() => setMode(m)}
              className={`rounded-lg border px-3 py-1.5 text-sm font-medium transition ${
                mode === m
                  ? "border-[--color-accent] text-[--color-accent]"
                  : "border-[--color-border] text-[--color-ink-muted]"
              }`}
            >
              {m === "import" ? "Import by FPL ID" : "Build manually"}
            </button>
          ))}
        </div>

        {mode === "import" ? (
          <form
            onSubmit={(e) => {
              e.preventDefault();
              const id = Number(entryId);
              if (!Number.isInteger(id) || id <= 0) {
                setError("Enter a valid FPL team ID — digits only.");
                return;
              }
              void analyse({ entryId: id });
            }}
            className="flex flex-col gap-3"
          >
            <label htmlFor="entryId" className="text-sm text-[--color-ink-muted]">
              FPL team ID
              <span className="ml-1 text-[--color-ink-faint]">
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
                className="numeric min-w-0 flex-1 rounded-lg border border-[--color-border] bg-[--color-surface-2] px-3 py-2.5 outline-none focus:border-[--color-accent]"
              />
              <button
                type="submit"
                disabled={pending || !entryId}
                className="shrink-0 rounded-lg bg-[--color-accent] px-4 py-2.5 font-semibold text-[--color-base] transition hover:bg-[--color-accent-dim] disabled:opacity-50"
              >
                {pending ? "Analysing…" : "Analyse"}
              </button>
            </div>
          </form>
        ) : (
          <SquadBuilder
            pending={pending}
            onSubmit={(playerIds) => void analyse({ playerIds })}
          />
        )}

        {error && (
          <p role="alert" className="mt-3 text-sm text-[--color-danger]">
            {error}
          </p>
        )}
      </Card>

      {result && (
        <>
          <Card className="p-5">
            <SectionHeading
              hint={`${result.optimal.formationLabel} · ${result.optimal.expectedPoints.toFixed(1)} xPts`}
            >
              Projected lineup
            </SectionHeading>
            <LineupTable
              startingXI={result.optimal.startingXI}
              bench={result.optimal.bench}
              gameweek={result.gameweek}
              horizon={result.horizon}
              captainId={result.analysis.captain.playerId}
              viceId={result.analysis.viceCaptain.playerId}
            />
          </Card>

          <AnalysisPanel
            analysis={result.analysis}
            gameweek={result.gameweek}
            optimalPoints={result.optimal.expectedPoints}
            formation={result.optimal.formationLabel}
            cached={result.cached}
            generatedAt={result.generatedAt}
          />

          {result.cached && (
            <button
              type="button"
              disabled={pending}
              onClick={() =>
                void analyse(
                  mode === "import"
                    ? { entryId: Number(entryId), refresh: true }
                    : { playerIds: result.squad.map((p) => p.playerId), refresh: true },
                )
              }
              className="self-start rounded-lg border border-[--color-border] px-4 py-2 text-sm text-[--color-ink-muted] transition hover:border-[--color-accent] hover:text-[--color-accent]"
            >
              Regenerate analysis
            </button>
          )}
        </>
      )}
    </div>
  );
}
