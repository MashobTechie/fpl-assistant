"use client";

import type { SavedDraft } from "@/lib/types";
import { Card, SectionHeading } from "./ui";

/**
 * Drafts the manager kept, for this gameweek.
 *
 * What is stored is the question — which players swap, and whether a chip is
 * played — so every row is re-checked and re-priced when it loads. That is the
 * point rather than a limitation: a draft saved on Tuesday against Wednesday's
 * prices is a different move, and showing Tuesday's verdict as though it still
 * held is how someone makes a transfer that no longer adds up.
 *
 * Deliberately shows the manager's own label and not the players. Two drafts
 * worth comparing usually differ by one name, so "Haaland or Watkins" tells
 * them apart and "3 moves" does not — which is why saving asks for a name.
 */
export function SavedDrafts({
  drafts,
  gameweek,
  busyId,
  onLoad,
  onDelete,
}: {
  drafts: SavedDraft[];
  gameweek: number;
  /** The draft currently being loaded or deleted, so the row can say so. */
  busyId: string | null;
  onLoad: (draft: SavedDraft) => void;
  onDelete: (draft: SavedDraft) => void;
}) {
  const forWeek = drafts.filter((d) => d.gameweek === gameweek);
  if (forWeek.length === 0) return null;

  return (
    <Card className="p-5 sm:p-6">
      <SectionHeading hint={`GW${gameweek}`}>Saved drafts</SectionHeading>

      <ul className="flex flex-col divide-y divide-[--color-border]">
        {forWeek.map((d) => {
          const busy = busyId === d.id;
          return (
            <li key={d.id} className="flex flex-wrap items-center gap-x-3 gap-y-2 py-2.5">
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm font-medium">{d.name}</span>
                <span className="text-[11px] text-[--color-ink-faint]">
                  {d.transfers.length} move{d.transfers.length === 1 ? "" : "s"}
                  {d.chip && (
                    <span className="ml-1.5 text-[--color-accent]">
                      · {d.chip === "wildcard" ? "Wildcard" : "Free Hit"}
                    </span>
                  )}
                  <span className="ml-1.5">· saved {relative(d.updated_at)}</span>
                </span>
              </span>
              <button
                type="button"
                disabled={busy}
                onClick={() => onLoad(d)}
                className="rounded-lg bg-[--color-cyan]/15 px-3 py-1.5 text-xs font-semibold text-[--color-cyan] ring-1 ring-[--color-cyan]/40 transition hover:bg-[--color-cyan]/25 disabled:opacity-50"
              >
                {busy ? "Checking…" : "Open"}
              </button>
              <button
                type="button"
                disabled={busy}
                onClick={() => onDelete(d)}
                className="rounded-lg border border-[--color-border] px-2.5 py-1.5 text-xs text-[--color-ink-muted] transition hover:border-[--color-pink] hover:text-[--color-pink] disabled:opacity-50"
                aria-label={`Delete ${d.name}`}
              >
                Delete
              </button>
            </li>
          );
        })}
      </ul>

      <p className="mt-3 border-t border-[--color-border] pt-3 text-xs leading-relaxed text-[--color-ink-faint]">
        Opening a draft re-checks it against today&rsquo;s prices and
        today&rsquo;s projections, so what you see is the move as it stands
        now, not as it stood when you saved it.
      </p>
    </Card>
  );
}

/** "3 days ago" beats a timestamp here: the question is how stale it is. */
function relative(iso: string): string {
  const seconds = Math.max(0, (Date.now() - new Date(iso).getTime()) / 1000);
  if (seconds < 90) return "just now";
  const minutes = seconds / 60;
  if (minutes < 60) return `${Math.round(minutes)} min ago`;
  const hours = minutes / 60;
  if (hours < 24) return `${Math.round(hours)}h ago`;
  const days = Math.round(hours / 24);
  return days === 1 ? "yesterday" : `${days} days ago`;
}
