"use client";

import { useState } from "react";

import type { GameweekReview, ReviewedPlayer } from "@/lib/squad/review";
import { Card, SectionHeading, StatTile } from "./ui";

/**
 * Last gameweek, and what it cost.
 *
 * The tone here is deliberate. Every one of these numbers is a mistake made in
 * hindsight, and a panel that shouts about them is one people stop opening. So
 * the headline is what was scored, the losses sit beside it as context, and the
 * full comparison is available rather than forced.
 *
 * Points left behind are shown against what was *legally* achievable, not the
 * bench total — you can never start all four substitutes, and a number nobody
 * could have reached is not a lesson.
 */

const CHIP_LABELS: Record<string, string> = {
  bboost: "Bench Boost",
  "3xc": "Triple Captain",
  freehit: "Free Hit",
  wildcard: "Wildcard",
};

function PlayerRow({
  player,
  shouldHaveStarted,
  wasRightCaptain,
}: {
  player: ReviewedPlayer;
  shouldHaveStarted: boolean;
  wasRightCaptain: boolean;
}) {
  return (
    <tr className="border-t border-[--color-border]">
      <td className="py-2 pr-2 text-xs font-semibold text-[--color-ink-faint]">
        {player.position}
      </td>
      <td className="py-2 pr-3">
        <span className="flex items-center gap-1.5">
          <span className={player.started ? "font-medium" : "text-[--color-ink-muted]"}>
            {player.webName}
          </span>
          {player.isCaptain && (
            <span
              title={wasRightCaptain ? "Captain — the right call" : "Captain"}
              className="flex h-4 w-4 items-center justify-center rounded-full bg-[--color-accent] text-[10px] font-bold text-[--color-base]"
            >
              C
            </span>
          )}
          {shouldHaveStarted && (
            <span className="eyebrow rounded bg-[--color-cyan]/15 px-1.5 py-0.5 text-[9px] text-[--color-cyan]">
              should have started
            </span>
          )}
          {player.started && player.minutes === 0 && (
            <span className="eyebrow rounded bg-[--color-pink]/15 px-1.5 py-0.5 text-[9px] text-[--color-pink]">
              did not play
            </span>
          )}
        </span>
        <span className="text-[11px] text-[--color-ink-faint]">
          {player.team} · {player.minutes}′
        </span>
      </td>
      <td className="numeric py-2 text-right font-semibold">
        {player.points}
        {player.isCaptain && (
          <span className="ml-1 text-[11px] font-normal text-[--color-ink-faint]">
            ×2
          </span>
        )}
      </td>
    </tr>
  );
}

export function ReviewPanel({ review }: { review: GameweekReview }) {
  const [open, setOpen] = useState(false);

  const bestIds = new Set(review.bestPossibleXI.map((p) => p.playerId));
  const missed = review.bestPossibleXI.filter((p) => !p.started);
  const captainWasRight = review.captainCost === 0;
  const perfect = review.lineupCost === 0 && review.captainCost === 0;

  const starters = review.squad.filter((p) => p.started);
  const bench = review.squad.filter((p) => !p.started);

  return (
    <Card className="p-5 sm:p-6">
      <SectionHeading
        hint={review.overallRank ? `Rank ${review.overallRank.toLocaleString()}` : undefined}
      >
        Gameweek {review.gameweek} review
      </SectionHeading>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <StatTile
          label="Scored"
          value={String(review.points)}
          sub={review.transferCost ? `after a −${review.transferCost} hit` : undefined}
          tone="accent"
        />
        <StatTile
          label="Best possible"
          value={String(review.bestPossible)}
          sub="from the same fifteen"
        />
        <StatTile
          label="Left behind"
          value={String(review.lineupCost)}
          sub={review.lineupCost > 0 ? "wrong XI" : "perfect XI"}
        />
        <StatTile
          label="Armband cost"
          value={String(review.captainCost)}
          sub={review.captain ? review.captain.webName : undefined}
        />
      </div>

      {review.chipPlayed && (
        <p className="mt-4 text-sm text-[--color-ink-muted]">
          Played the{" "}
          <span className="font-semibold text-[--color-cyan]">
            {CHIP_LABELS[review.chipPlayed] ?? review.chipPlayed}
          </span>
          .
        </p>
      )}

      <ul className="mt-4 flex flex-col gap-2">
        {review.lessons.map((lesson, i) => (
          <li
            key={i}
            className={`flex gap-2.5 rounded-lg px-3.5 py-2.5 text-sm leading-relaxed ${
              perfect
                ? "bg-[--color-accent]/10 text-[--color-ink-muted]"
                : "bg-[--color-surface-2] text-[--color-ink-muted]"
            }`}
          >
            <span
              aria-hidden
              className={`mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full ${
                perfect ? "bg-[--color-accent]" : "bg-[--color-pink]"
              }`}
            />
            {lesson}
          </li>
        ))}
      </ul>

      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="mt-4 self-start text-sm font-medium text-[--color-cyan] transition hover:underline"
      >
        {open ? "Hide the full squad" : "See every player’s score"}
      </button>

      {open && (
        <div className="scroll-x mt-3">
          <table className="w-full min-w-[22rem] text-sm">
            <thead>
              <tr className="text-[11px] uppercase tracking-wider text-[--color-ink-faint]">
                <th className="pb-2 text-left font-medium">Pos</th>
                <th className="pb-2 text-left font-medium">Player</th>
                <th className="pb-2 text-right font-medium">Pts</th>
              </tr>
            </thead>
            <tbody>
              {starters.map((p) => (
                <PlayerRow
                  key={p.playerId}
                  player={p}
                  shouldHaveStarted={false}
                  wasRightCaptain={captainWasRight}
                />
              ))}
              <tr className="border-t border-[--color-border]">
                <td
                  colSpan={3}
                  className="eyebrow pt-3 pb-1 text-[10px] text-[--color-ink-faint]"
                >
                  Bench — {review.benchPoints} points unused
                </td>
              </tr>
              {bench.map((p) => (
                <PlayerRow
                  key={p.playerId}
                  player={p}
                  shouldHaveStarted={bestIds.has(p.playerId)}
                  wasRightCaptain={captainWasRight}
                />
              ))}
            </tbody>
          </table>

          {missed.length > 0 && (
            <p className="mt-3 text-xs leading-relaxed text-[--color-ink-faint]">
              “Left behind” counts only what a legal formation could have
              fielded, so it is smaller than the {review.benchPoints} points sat
              on the bench — you can never start all four substitutes.
            </p>
          )}
        </div>
      )}
    </Card>
  );
}
