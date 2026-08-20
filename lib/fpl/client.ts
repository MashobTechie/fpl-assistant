/**
 * Server-side client for the FPL API.
 *
 * MUST NOT be imported into a client component: the FPL API sends no CORS
 * headers, so browser calls fail. Everything here runs in route handlers,
 * server components, or server actions.
 */

import { cached } from "./cache";
import type {
  FplBootstrap,
  FplElement,
  FplEntry,
  FplFixture,
  FplPicks,
} from "./types";

const BASE = "https://fantasy.premierleague.com/api";

/**
 * FPL rejects some default clients, so we present a browser UA. Response
 * bodies are large (~1.5MB uncompressed for bootstrap) but compress ~11x,
 * which node's fetch requests by default.
 */
const HEADERS = {
  "User-Agent":
    "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
  Accept: "application/json",
} as const;

export class FplApiError extends Error {
  constructor(
    readonly path: string,
    readonly status: number,
  ) {
    super(`FPL API ${path} responded ${status}`);
    this.name = "FplApiError";
  }
}

async function get<T>(path: string): Promise<T> {
  // `cache: "no-store"` deliberately: these payloads exceed Next's 2MB data
  // cache limit, so we memoise the trimmed result ourselves instead.
  const res = await fetch(`${BASE}${path}`, {
    headers: HEADERS,
    cache: "no-store",
  });
  if (!res.ok) throw new FplApiError(path, res.status);
  return (await res.json()) as T;
}

/**
 * Keeps only the element fields the projection engine reads. The full payload
 * carries roughly a hundred fields per player, most of which we never touch.
 */
const ELEMENT_FIELDS = [
  "id", "code", "web_name", "first_name", "second_name", "team", "element_type",
  "now_cost", "status", "chance_of_playing_next_round", "news",
  "minutes", "starts", "total_points", "goals_scored", "assists", "clean_sheets",
  "saves", "bonus", "bps", "defensive_contribution",
  "expected_goals_per_90", "expected_assists_per_90", "expected_goals_conceded_per_90",
  "saves_per_90", "starts_per_90", "defensive_contribution_per_90",
  "form", "points_per_game", "selected_by_percent", "ep_next",
  "expected_goals", "expected_assists",
  "penalties_order", "corners_and_indirect_freekicks_order", "direct_freekicks_order",
] as const satisfies readonly (keyof FplElement)[];

function trimBootstrap(raw: FplBootstrap): FplBootstrap {
  return {
    events: raw.events.map((e) => ({
      id: e.id, name: e.name, deadline_time: e.deadline_time,
      finished: e.finished, is_current: e.is_current,
      is_next: e.is_next, is_previous: e.is_previous,
    })),
    teams: raw.teams.map((t) => ({
      id: t.id, name: t.name, short_name: t.short_name,
      strength_overall_home: t.strength_overall_home,
      strength_overall_away: t.strength_overall_away,
      strength_attack_home: t.strength_attack_home,
      strength_attack_away: t.strength_attack_away,
      strength_defence_home: t.strength_defence_home,
      strength_defence_away: t.strength_defence_away,
    })),
    element_types: raw.element_types.map((t) => ({
      id: t.id, singular_name_short: t.singular_name_short,
    })),
    elements: raw.elements.map((el) => {
      const out = {} as Record<string, unknown>;
      for (const key of ELEMENT_FIELDS) out[key] = el[key];
      return out as unknown as FplElement;
    }),
  };
}

/** Fixtures carry a per-match `stats` array we never read; drop it. */
function trimFixtures(raw: FplFixture[]): FplFixture[] {
  return raw.map((f) => ({
    id: f.id, event: f.event, finished: f.finished,
    kickoff_time: f.kickoff_time, team_h: f.team_h, team_a: f.team_a,
    team_h_difficulty: f.team_h_difficulty, team_a_difficulty: f.team_a_difficulty,
  }));
}

/**
 * Players, teams, gameweeks. Revalidated hourly — prices and injury news are
 * the fastest-moving parts and neither turns over faster than that.
 */
export function getBootstrap(): Promise<FplBootstrap> {
  return cached("bootstrap", 3600, async () =>
    trimBootstrap(await get<FplBootstrap>("/bootstrap-static/")),
  );
}

/** All 380 fixtures with per-team FDR. Changes rarely; cached for 6h. */
export function getFixtures(): Promise<FplFixture[]> {
  return cached("fixtures", 21_600, async () =>
    trimFixtures(await get<FplFixture[]>("/fixtures/")),
  );
}

/** Manager metadata. Cached briefly so a bad FPL ID isn't re-fetched in a loop. */
export function getEntry(entryId: number): Promise<FplEntry> {
  return cached(`entry:${entryId}`, 300, () => get<FplEntry>(`/entry/${entryId}/`));
}

/**
 * A manager's 15 picks for one gameweek.
 *
 * Returns 404 before a manager has picks for that gameweek — which includes
 * every manager before the GW1 deadline. Callers must handle null.
 */
export async function getPicks(
  entryId: number,
  gameweek: number,
): Promise<FplPicks | null> {
  try {
    return await cached(`picks:${entryId}:${gameweek}`, 300, () =>
      get<FplPicks>(`/entry/${entryId}/event/${gameweek}/picks/`),
    );
  } catch (err) {
    if (err instanceof FplApiError && err.status === 404) return null;
    throw err;
  }
}

/** The gameweek to analyse: the next one if the season hasn't started. */
export function resolveTargetGameweek(bootstrap: FplBootstrap): number {
  const next = bootstrap.events.find((e) => e.is_next);
  if (next) return next.id;
  const current = bootstrap.events.find((e) => e.is_current);
  if (current) return current.id;
  // Season over — fall back to the last gameweek so the UI still renders.
  return bootstrap.events[bootstrap.events.length - 1]?.id ?? 1;
}
