"use client";

import { useState } from "react";

import type { AnalysisResponse } from "@/lib/types";
import { AnalysisPanel } from "./AnalysisPanel";
import { LineupTable } from "./LineupTable";
import { SquadBuilder } from "./SquadBuilder";
import { Button, Card, SectionHeading, SegmentedControl } from "./ui";

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
      <Card accent className="p-5 sm:p-6">
        <SectionHeading hint={result ? `GW${result.gameweek}` : undefined}>
          Your squad
        </SectionHeading>

        <div className="mb-5">
          <SegmentedControl
            value={mode}
            onChange={setMode}
            options={[
              { value: "import", label: "Import by FPL ID" },
              { value: "manual", label: "Build manually" },
            ]}
          />
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
            <label htmlFor="entryId" className="eyebrow text-[11px] text-[--color-ink-faint]">
              FPL team ID
              <span className="ml-1.5 normal-case tracking-normal text-[--color-ink-faint]">
                the number in your points-page URL
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
                {pending ? "Analysing…" : "Analyse"}
              </Button>
            </div>
          </form>
        ) : (
          <SquadBuilder
            pending={pending}
            onSubmit={(playerIds) => void analyse({ playerIds })}
          />
        )}

        {error && (
          <div
            role="alert"
            className="mt-4 rounded-lg border border-[--color-pink]/40 bg-[--color-pink]/10 px-4 py-3"
          >
            <p className="text-sm leading-relaxed text-[--color-ink]">{error}</p>
          </div>
        )}
      </Card>

      {result && (
        <>
          <Card className="p-5 sm:p-6">
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
            <Button
              variant="ghost"
              disabled={pending}
              onClick={() =>
                void analyse(
                  mode === "import"
                    ? { entryId: Number(entryId), refresh: true }
                    : { playerIds: result.squad.map((p) => p.playerId), refresh: true },
                )
              }
              className="self-start text-sm"
            >
              Regenerate analysis
            </Button>
          )}
        </>
      )}
    </div>
  );
}
