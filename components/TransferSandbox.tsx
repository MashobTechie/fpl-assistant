"use client";

import { useEffect, useMemo, useState } from "react";

import type { PlayerProjection } from "@/lib/projections/engine";
import {
  MAX_PER_CLUB,
  type PlayerListItem,
  type PlayersResponse,
  type ProjectionsResponse,
} from "@/lib/types";
import { PitchView, type PitchEditing } from "./PitchView";
import { Button } from "./ui";

/** Only what a chosen replacement needs to be shown and priced. */
export type Incoming = Pick<PlayerListItem, "id" | "name" | "team" | "cost">;

/**
 * Try transfers on your real squad before making them in FPL.
 *
 * Two questions, answered in two places on purpose. As you click, the panel
 * gives an instant estimate — money left, hits, club limits — from the selling
 * prices it was sent, so an obviously impossible move shows up before you ask.
 * The button then asks the server, which applies the same rules FPL does and is
 * the only authority: an estimate that disagrees with the real app is worse
 * than no estimate at all.
 */
export function TransferSandbox({
  projections,
  checking,
  error,
  onCheck,
  onClose,
  initialMoves,
}: {
  projections: ProjectionsResponse;
  /** Moves to start from — the draft being edited, when there is one. */
  initialMoves?: Map<number, Incoming>;
  checking: boolean;
  error: string | null;
  onCheck: (transfers: { out: number; in: number }[]) => void;
  onClose: () => void;
}) {
  const [players, setPlayers] = useState<PlayerListItem[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  // Sold player id → chosen replacement, or null while the slot is still empty.
  const [moves, setMoves] = useState<Map<number, Incoming | null>>(
    () => new Map(initialMoves ?? []),
  );
  const [picking, setPicking] = useState<PlayerProjection | null>(null);
  const [query, setQuery] = useState("");

  useEffect(() => {
    let cancelled = false;
    fetch("/api/players")
      .then((r) => {
        if (!r.ok) throw new Error(`Player list unavailable (${r.status})`);
        return r.json() as Promise<PlayersResponse>;
      })
      .then((d) => !cancelled && setPlayers(d.players))
      .catch((e: Error) => !cancelled && setLoadError(e.message));
    return () => {
      cancelled = true;
    };
  }, []);

  const { economics, transfers: budget, squad } = projections;
  const ownedIds = useMemo(() => new Set(squad.map((p) => p.playerId)), [squad]);
  const squadById = useMemo(() => new Map(squad.map((p) => [p.playerId, p])), [squad]);

  // ---- The live estimate --------------------------------------------------
  const summary = useMemo(() => {
    let bank = economics.bank;
    const clubs: Record<string, number> = { ...economics.clubCounts };
    let filled = 0;
    for (const [outId, incoming] of moves) {
      const out = squadById.get(outId);
      if (!out) continue;
      bank += economics.sellPrice[outId] ?? out.cost;
      clubs[out.team] = (clubs[out.team] ?? 0) - 1;
      if (incoming) {
        filled++;
        bank -= incoming.cost;
        clubs[incoming.team] = (clubs[incoming.team] ?? 0) + 1;
      }
    }
    const count = moves.size;
    const hit = Math.max(0, count - budget.free) * budget.hitCost;
    const overClub = Object.entries(clubs).filter(([, n]) => n > MAX_PER_CLUB);
    return {
      bank: Math.round(bank * 10) / 10,
      count,
      filled,
      hit,
      overClub,
      clubs,
    };
  }, [moves, economics, budget, squadById]);

  const problems: string[] = [];
  if (summary.filled < summary.count) {
    const open = summary.count - summary.filled;
    problems.push(`Pick ${open === 1 ? "a replacement" : `${open} replacements`} for the sold ${open === 1 ? "player" : "players"}.`);
  }
  if (summary.filled === summary.count && summary.bank < -0.001) {
    problems.push(`£${Math.abs(summary.bank).toFixed(1)}m short — sell someone dearer or buy someone cheaper.`);
  }
  for (const [club, n] of summary.overClub) {
    problems.push(`${n} players from ${club} — the limit is ${MAX_PER_CLUB}.`);
  }

  const ready = summary.count > 0 && problems.length === 0;

  const editing: PitchEditing = {
    sold: new Map(
      [...moves].map(([id, p]) => [id, p ? { name: p.name, team: p.team, price: p.cost } : null]),
    ),
    onSell: (player) => {
      setMoves((m) => new Map(m).set(player.playerId, null));
      setPicking(player);
      setQuery("");
    },
    onReplace: (player) => {
      setPicking(player);
      setQuery("");
    },
    onUndo: (player) => {
      setMoves((m) => {
        const next = new Map(m);
        next.delete(player.playerId);
        return next;
      });
      if (picking?.playerId === player.playerId) setPicking(null);
    },
  };

  // ---- The picker ---------------------------------------------------------
  const alreadyBought = new Set(
    [...moves.values()].filter((p): p is Incoming => p !== null).map((p) => p.id),
  );

  const options = useMemo(() => {
    if (!players || !picking) return [];
    const q = query.trim().toLowerCase();
    return players
      .filter((p) => p.position === picking.position)
      // Buying back a player you just sold is an undo, and has its own button.
      .filter((p) => !ownedIds.has(p.id))
      .filter((p) => !q || p.name.toLowerCase().includes(q) || p.team.toLowerCase().includes(q))
      .slice(0, 50);
  }, [players, picking, query, ownedIds]);

  /** What the bank would read if this player filled the open slot. */
  function bankIfPicked(p: PlayerListItem): number {
    const current = picking ? moves.get(picking.playerId) : null;
    return summary.bank + (current?.cost ?? 0) - p.cost;
  }

  function clubFullFor(p: PlayerListItem): boolean {
    const current = picking ? moves.get(picking.playerId) : null;
    const held = (summary.clubs[p.team] ?? 0) - (current?.team === p.team ? 1 : 0);
    return held >= MAX_PER_CLUB;
  }

  function choose(p: PlayerListItem) {
    if (!picking) return;
    setMoves((m) => new Map(m).set(picking.playerId, p));
    setPicking(null);
  }

  return (
    <div className="flex flex-col gap-4">
      <p className="text-sm leading-relaxed text-[--color-ink-muted]">
        Tap <span className="font-bold text-[--color-pink]">×</span> on a shirt to
        sell him, then pick who comes in. Nothing changes in FPL — this only
        checks whether you could make the moves, and whether they are worth it.
      </p>

      <PitchView
        startingXI={projections.optimal.startingXI}
        bench={projections.optimal.bench}
        gameweek={projections.gameweek}
        formationLabel={projections.optimal.formationLabel}
        expectedPoints={projections.optimal.expectedPoints}
        editing={editing}
      />

      {picking && (
        <div className="rounded-xl border border-[--color-border-bright] bg-[--color-surface-2] p-3">
          <div className="mb-2 flex items-center justify-between gap-3">
            <p className="text-sm">
              Replacing <span className="font-semibold">{picking.webName}</span>
              <span className="ml-1.5 text-[--color-ink-faint]">
                · sells for £{(economics.sellPrice[picking.playerId] ?? picking.cost).toFixed(1)}m
              </span>
            </p>
            <button
              type="button"
              onClick={() => setPicking(null)}
              className="text-xs text-[--color-ink-muted] hover:text-[--color-ink]"
            >
              Close
            </button>
          </div>

          <input
            type="search"
            autoFocus
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={`Search ${picking.position} by name or club…`}
            className="mb-2 w-full rounded-lg border border-[--color-border] bg-[--color-base] px-3 py-2 text-sm outline-none focus:border-[--color-cyan]"
          />

          {loadError && <p className="text-sm text-[--color-pink]">{loadError}</p>}
          {!players && !loadError && (
            <p className="text-sm text-[--color-ink-muted]">Loading players…</p>
          )}

          <ul className="max-h-72 divide-y divide-[--color-border] overflow-y-auto rounded-lg border border-[--color-border]">
            {options.map((p) => {
              const left = bankIfPicked(p);
              const cantAfford = left < -0.001;
              const clubFull = clubFullFor(p);
              const taken = alreadyBought.has(p.id);
              const blocked = cantAfford || clubFull || taken;
              return (
                <li key={p.id}>
                  <button
                    type="button"
                    disabled={blocked}
                    onClick={() => choose(p)}
                    title={
                      taken
                        ? "Already bought in this draft"
                        : clubFull
                          ? `You would have ${MAX_PER_CLUB + 1} from ${p.team}`
                          : cantAfford
                            ? `£${Math.abs(left).toFixed(1)}m short`
                            : undefined
                    }
                    className="flex w-full items-center gap-3 px-3 py-2 text-left text-sm transition hover:bg-[--color-surface-3] disabled:cursor-not-allowed disabled:opacity-40"
                  >
                    <span className="min-w-0 flex-1">
                      <span className="block truncate font-medium">
                        {p.name}
                        {p.status !== "a" && (
                          <span className="ml-1 text-[--color-pink]" title={p.risks[0]}>
                            ⚠
                          </span>
                        )}
                      </span>
                      <span className="text-[11px] text-[--color-ink-faint]">
                        {p.team} · {p.minutes}′ ·{" "}
                        {cantAfford ? (
                          <span className="text-[--color-pink]">£{Math.abs(left).toFixed(1)}m short</span>
                        ) : clubFull ? (
                          <span className="text-[--color-pink]">club full</span>
                        ) : (
                          <>£{left.toFixed(1)}m left</>
                        )}
                      </span>
                    </span>
                    <span className="numeric w-14 text-right text-[--color-ink-muted]">
                      £{p.cost.toFixed(1)}m
                    </span>
                    <span
                      className="numeric w-12 text-right font-semibold text-[--color-accent]"
                      title={`Expected points over the next ${projections.horizon} gameweeks`}
                    >
                      {p.horizon.toFixed(1)}
                    </span>
                  </button>
                </li>
              );
            })}
            {players && options.length === 0 && (
              <li className="px-3 py-4 text-sm text-[--color-ink-muted]">
                No {picking.position} matches “{query}”.
              </li>
            )}
          </ul>
          <p className="mt-2 text-[11px] text-[--color-ink-faint]">
            Right-hand number: expected points over the next {projections.horizon} gameweeks.
          </p>
        </div>
      )}

      {/* The running total. Estimates only — the check below is the authority. */}
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        <Tally label="Transfers" value={String(summary.count)} />
        <Tally label="Free" value={String(budget.free)} sub={budget.inferred ? "from your history" : undefined} />
        <Tally
          label="Hit"
          value={summary.hit ? `−${summary.hit}` : "0"}
          tone={summary.hit ? "bad" : "default"}
        />
        <Tally
          label="Bank after"
          value={`£${summary.bank.toFixed(1)}m`}
          tone={summary.bank < -0.001 ? "bad" : "default"}
        />
      </div>

      {problems.length > 0 && summary.count > 0 && (
        <ul className="flex flex-col gap-1.5">
          {problems.map((p) => (
            <li key={p} className="text-sm text-[--color-pink]">
              {p}
            </li>
          ))}
        </ul>
      )}

      {error && (
        <p
          role="alert"
          className="rounded-lg border border-[--color-pink]/40 bg-[--color-pink]/10 px-3.5 py-2.5 text-sm text-[--color-pink]"
        >
          {error}
        </p>
      )}

      <div className="flex flex-wrap items-center gap-3">
        <Button
          disabled={!ready || checking}
          onClick={() =>
            onCheck(
              [...moves].map(([out, incoming]) => ({ out, in: incoming!.id })),
            )
          }
        >
          {checking ? "Checking…" : "Check it & analyse"}
        </Button>
        {summary.count > 0 && (
          <Button variant="ghost" onClick={() => setMoves(new Map())} disabled={checking}>
            Reset
          </Button>
        )}
        <Button variant="ghost" onClick={onClose} disabled={checking}>
          Cancel
        </Button>
      </div>
    </div>
  );
}

function Tally({
  label,
  value,
  sub,
  tone = "default",
}: {
  label: string;
  value: string;
  sub?: string;
  tone?: "default" | "bad";
}) {
  return (
    <div className="rounded-lg border border-[--color-border] bg-[--color-base] px-3 py-2">
      <div className="eyebrow text-[9px] text-[--color-ink-faint]">{label}</div>
      <div
        className={`numeric mt-1 text-lg font-bold leading-none ${
          tone === "bad" ? "text-[--color-pink]" : "text-[--color-ink]"
        }`}
      >
        {value}
      </div>
      {sub && <div className="mt-1 text-[10px] text-[--color-ink-faint]">{sub}</div>}
    </div>
  );
}
