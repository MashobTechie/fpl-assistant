"use client";

import { useEffect, useMemo, useState } from "react";

import {
  MAX_PER_CLUB,
  SQUAD_BUDGET,
  SQUAD_QUOTA,
  type PlayerListItem,
  type PlayersResponse,
} from "@/lib/types";
import { FdrPill } from "./ui";

type Position = PlayerListItem["position"];
const POSITIONS: Position[] = ["GKP", "DEF", "MID", "FWD"];

/**
 * Manual 15-player squad selection.
 *
 * This is the only route into the app before a gameweek deadline: FPL does not
 * expose a manager's picks until their deadline has passed, so importing by
 * team ID is impossible for a squad that has not yet been locked in.
 */
export function SquadBuilder({
  onSubmit,
  pending,
}: {
  onSubmit: (playerIds: number[]) => void;
  pending: boolean;
}) {
  const [players, setPlayers] = useState<PlayerListItem[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [selected, setSelected] = useState<PlayerListItem[]>([]);
  const [query, setQuery] = useState("");
  const [position, setPosition] = useState<Position>("MID");

  useEffect(() => {
    let cancelled = false;
    fetch("/api/players")
      .then((r) => {
        if (!r.ok) throw new Error(`Player list unavailable (${r.status})`);
        return r.json() as Promise<PlayersResponse>;
      })
      .then((d) => {
        if (!cancelled) setPlayers(d.players);
      })
      .catch((e: Error) => {
        if (!cancelled) setLoadError(e.message);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const counts = useMemo(() => {
    const c: Record<Position, number> = { GKP: 0, DEF: 0, MID: 0, FWD: 0 };
    for (const p of selected) c[p.position]++;
    return c;
  }, [selected]);

  const spend = useMemo(
    () => selected.reduce((sum, p) => sum + p.cost, 0),
    [selected],
  );

  const selectedIds = useMemo(
    () => new Set(selected.map((p) => p.id)),
    [selected],
  );

  /** FPL allows at most three players from any one club. */
  const clubCounts = useMemo(() => {
    const c = new Map<string, number>();
    for (const p of selected) c.set(p.team, (c.get(p.team) ?? 0) + 1);
    return c;
  }, [selected]);

  const visible = useMemo(() => {
    if (!players) return [];
    const q = query.trim().toLowerCase();
    return players
      .filter((p) => p.position === position)
      .filter(
        (p) =>
          !q ||
          p.name.toLowerCase().includes(q) ||
          p.team.toLowerCase().includes(q),
      )
      .slice(0, 60);
  }, [players, position, query]);

  const complete = POSITIONS.every((pos) => counts[pos] === SQUAD_QUOTA[pos]);
  const overBudget = spend > SQUAD_BUDGET;

  function blockedReason(player: PlayerListItem): string | null {
    if (selectedIds.has(player.id)) return null;
    if (counts[player.position] >= SQUAD_QUOTA[player.position]) {
      return `You already have ${SQUAD_QUOTA[player.position]} ${player.position}`;
    }
    if ((clubCounts.get(player.team) ?? 0) >= MAX_PER_CLUB) {
      return `Max ${MAX_PER_CLUB} players from ${player.team}`;
    }
    return null;
  }

  function toggle(player: PlayerListItem) {
    if (selectedIds.has(player.id)) {
      setSelected((s) => s.filter((p) => p.id !== player.id));
    } else if (!blockedReason(player)) {
      setSelected((s) => [...s, player]);
    }
  }

  if (loadError) {
    return (
      <p className="rounded-lg border border-[--color-pink]/40 bg-[--color-pink]/10 px-3.5 py-3 text-sm text-[--color-pink]">
        Couldn&apos;t load players: {loadError}
      </p>
    );
  }
  if (!players) {
    return <p className="text-sm text-[--color-ink-muted]">Loading players…</p>;
  }

  return (
    <div className="flex flex-col gap-4">
      {/* Quota + budget state */}
      <div className="flex flex-wrap items-center gap-2">
        {POSITIONS.map((pos) => {
          const done = counts[pos] === SQUAD_QUOTA[pos];
          return (
            <button
              key={pos}
              type="button"
              onClick={() => setPosition(pos)}
              className={`numeric rounded-lg border px-2.5 py-1.5 text-xs font-bold transition ${
                position === pos
                  ? "border-[--color-cyan] bg-[--color-cyan]/10 text-[--color-cyan]"
                  : done
                    ? "border-[--color-accent]/50 text-[--color-accent]"
                    : "border-[--color-border] text-[--color-ink-muted] hover:border-[--color-border-bright]"
              }`}
            >
              {pos} {counts[pos]}/{SQUAD_QUOTA[pos]}
              {done && " ✓"}
            </button>
          );
        })}
        <span className="ml-auto text-right">
          <span className="eyebrow block text-[9px] text-[--color-ink-faint]">
            {overBudget ? "Over budget" : "Remaining"}
          </span>
          <span
            className={`numeric block text-sm font-bold ${
              overBudget ? "text-[--color-pink]" : "text-[--color-accent]"
            }`}
          >
            £{Math.abs(SQUAD_BUDGET - spend).toFixed(1)}m
          </span>
        </span>
      </div>

      <input
        type="search"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder={`Search ${position} by name or team…`}
        className="rounded-lg border border-[--color-border] bg-[--color-base] px-3.5 py-2.5 text-sm outline-none transition focus:border-[--color-cyan]"
      />

      <ul className="max-h-80 divide-y divide-[--color-border] overflow-y-auto rounded-lg border border-[--color-border]">
        {visible.map((p) => {
          const isSelected = selectedIds.has(p.id);
          const blocked = blockedReason(p);
          return (
            <li key={p.id}>
              <button
                type="button"
                onClick={() => toggle(p)}
                disabled={blocked !== null}
                title={blocked ?? undefined}
                className={`flex w-full items-center gap-3 px-3 py-2 text-left text-sm transition disabled:opacity-40 ${
                  isSelected ? "bg-[--color-accent]/10" : "hover:bg-[--color-surface-2]"
                }`}
              >
                <span className="min-w-0 flex-1">
                  <span className="flex items-center gap-1.5">
                    <span className="truncate font-medium">{p.name}</span>
                    {p.status !== "a" && (
                      <span className="text-[--color-pink]" title={p.risks[0]}>
                        ⚠
                      </span>
                    )}
                  </span>
                  <span className="text-[11px] text-[--color-ink-faint]">
                    {p.team}
                    {(clubCounts.get(p.team) ?? 0) > 0 &&
                      ` ${clubCounts.get(p.team)}/${MAX_PER_CLUB}`}
                    {" · "}£{p.cost.toFixed(1)}m · {p.minutes}′
                  </span>
                </span>
                <span className="hidden gap-1 sm:flex">
                  {p.fixtures.slice(0, 3).map((f, i) => (
                    <FdrPill key={i} opponent={f.opponent} home={f.home} fdr={f.fdr} />
                  ))}
                </span>
                <span className="numeric w-12 text-right font-bold text-[--color-accent]">
                  {p.horizon.toFixed(1)}
                </span>
                <span className="numeric w-4 text-center font-bold text-[--color-accent]">
                  {isSelected ? "✓" : ""}
                </span>
              </button>
            </li>
          );
        })}
        {visible.length === 0 && (
          <li className="px-3 py-4 text-sm text-[--color-ink-muted]">
            No {position} matches “{query}”.
          </li>
        )}
      </ul>

      <button
        type="button"
        disabled={!complete || overBudget || pending}
        onClick={() => onSubmit(selected.map((p) => p.id))}
        className="rounded-lg bg-[--color-accent] px-4 py-3 font-semibold text-[--color-base] transition hover:bg-[--color-accent-dim] active:translate-y-px disabled:opacity-50"
      >
        {pending
          ? "Analysing…"
          : overBudget
            ? "Over budget"
            : complete
              ? "Analyse this squad"
              : `Pick ${15 - selected.length} more`}
      </button>
    </div>
  );
}
