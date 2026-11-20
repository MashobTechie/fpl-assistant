/**
 * Keeping an unsaved draft across a reload.
 *
 * A draft lives in React state and nowhere else, deliberately: writing it to
 * the squads table would overwrite the real squad, which is the whole reason
 * drafts were never persisted. The cost was that a refresh — or a tab the
 * browser restored the next morning — silently threw away moves someone was
 * part-way through judging.
 *
 * sessionStorage is the right scope for that. It is this tab only, it never
 * reaches the server, and it dies with the session, so an abandoned draft
 * cannot resurface a week later looking current. Drafts worth keeping longer
 * are saved explicitly and live in Postgres.
 *
 * Every access is wrapped: storage throws in a private window and can be
 * disabled outright, and a draft is a convenience — it must never be the
 * reason the dashboard fails to load.
 */

export interface DraftSession {
  gameweek: number;
  /**
   * The squad the swaps were priced against — an FPL id, or the fifteen
   * themselves for a manually built squad. A draft is not portable between
   * squads: re-applying it to a different one is how a restore turns into
   * moves the manager never proposed.
   */
  entryId: number | null;
  playerIds: number[] | null;
  transfers: { out: number; in: number }[];
  chip: "wildcard" | "freehit" | null;
}

const KEY = "fpl-assistant.draft";

export function rememberDraft(draft: DraftSession): void {
  try {
    sessionStorage.setItem(KEY, JSON.stringify(draft));
  } catch {
    // Storage full, disabled, or a private window. The draft is still on
    // screen; it just will not survive a reload.
  }
}

export function forgetDraft(): void {
  try {
    sessionStorage.removeItem(KEY);
  } catch {
    // Nothing to do: a draft we cannot remove is one we also cannot read.
  }
}

/**
 * Read back a draft, or null.
 *
 * Validates rather than trusts. The value survives a deploy, so it can have
 * been written by an older build with a different shape, and it is editable by
 * hand — so anything unexpected is dropped rather than fed to the API.
 */
export function recallDraft(): DraftSession | null {
  let raw: string | null = null;
  try {
    raw = sessionStorage.getItem(KEY);
  } catch {
    return null;
  }
  if (!raw) return null;

  try {
    const value: unknown = JSON.parse(raw);
    if (typeof value !== "object" || value === null) return null;
    const d = value as Record<string, unknown>;

    if (!Number.isInteger(d.gameweek)) return null;
    if (!Array.isArray(d.transfers) || d.transfers.length === 0) return null;

    const entryId = Number.isInteger(d.entryId) ? (d.entryId as number) : null;
    const playerIds =
      Array.isArray(d.playerIds) && d.playerIds.every((id) => Number.isInteger(id))
        ? (d.playerIds as number[])
        : null;
    // One or the other, never neither: a draft with nothing to re-price
    // against cannot be restored.
    if (entryId === null && playerIds === null) return null;

    const transfers: { out: number; in: number }[] = [];
    for (const t of d.transfers) {
      if (typeof t !== "object" || t === null) return null;
      const pair = t as Record<string, unknown>;
      if (!Number.isInteger(pair.out) || !Number.isInteger(pair.in)) return null;
      transfers.push({ out: pair.out as number, in: pair.in as number });
    }

    const chip =
      d.chip === "wildcard" || d.chip === "freehit" ? d.chip : null;

    return { gameweek: d.gameweek as number, entryId, playerIds, transfers, chip };
  } catch {
    return null;
  }
}
