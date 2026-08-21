/**
 * Server-side client for the FPL API.
 *
 * MUST NOT be imported into a client component: the FPL API sends no CORS
 * headers, so browser calls fail. Everything here runs in route handlers,
 * server components, or server actions.
 */

import { cached } from "./cache";
import { applyLastSeason, seasonTotalsAreEmpty } from "./history";
import { readCachedPayload, readPlayerHistory, writeCachedPayload } from "./store";
import type {
  FplBootstrap,
  FplElement,
  FplEntry,
  FplFixture,
  FplElementSummary,
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
  // Discipline and penalty events. All carry FPL points.
  "yellow_cards", "red_cards", "own_goals",
  "penalties_saved", "penalties_missed",
  "expected_goals_per_90", "expected_assists_per_90", "expected_goals_conceded_per_90",
  "saves_per_90", "starts_per_90", "defensive_contribution_per_90",
  "form", "points_per_game", "selected_by_percent", "ep_next",
  "expected_goals", "expected_assists",
  "penalties_order", "corners_and_indirect_freekicks_order", "direct_freekicks_order",
  // Price movement. FPL publishes its own forecast in price_change_projections,
  // so predicting rises is largely a matter of not discarding the field.
  "cost_change_event", "cost_change_start",
  "cost_change_event_fall", "cost_change_start_fall",
  "transfers_in_event", "transfers_out_event",
  "price_change_projections", "price_change_percent",
  "price_change_hourly_rate", "price_change_locked_until",
  "price_change_calibrating",
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
 * Straight from FPL, past every cache.
 *
 * The snapshot job uses these: a job whose purpose is to refresh the cache
 * must not read from the cache it is refreshing. Everything else should use
 * getBootstrap/getFixtures below.
 */
export async function getBootstrapLive(): Promise<FplBootstrap> {
  return trimBootstrap(await get<FplBootstrap>("/bootstrap-static/"));
}

export async function getFixturesLive(): Promise<FplFixture[]> {
  return trimFixtures(await get<FplFixture[]>("/fixtures/"));
}

/**
 * Reads through three layers, cheapest first: this instance's memo, then the
 * shared Postgres copy, then FPL itself.
 *
 * The middle layer is the point. Without it each serverless instance keeps its
 * own copy, so two requests a second apart can see prices an hour apart — and
 * an FPL outage takes the app down rather than making it slightly stale.
 *
 * `maxAgeSeconds` applies to the stored copy as well as the memo, so freshness
 * is unchanged from before; what changes is that instances now agree. A live
 * fetch writes back, so a stale stored copy self-heals on the next request
 * instead of sending every instance to FPL.
 */
async function readThrough<T>(
  key: string,
  maxAgeSeconds: number,
  fetchLive: () => Promise<T>,
): Promise<T> {
  const stored = await readCachedPayload<T>(key, maxAgeSeconds);
  if (stored) return stored;

  const fresh = await fetchLive();
  void writeCachedPayload(key, fresh);
  return fresh;
}

/**
 * Players, teams, gameweeks. Revalidated hourly — prices and injury news are
 * the fastest-moving parts and neither turns over faster than that.
 */
export function getBootstrap(): Promise<FplBootstrap> {
  return cached("bootstrap", 3600, async () => {
    const bootstrap = await readThrough("bootstrap", 3600, getBootstrapLive);

    // FPL zeroes every season total at the first deadline of a new season, and
    // the engine reads exactly those fields — so without this every player
    // silently becomes a price-based guess. Overlaying here keeps the whole
    // engine, and every model built on it, working unchanged.
    if (!seasonTotalsAreEmpty(bootstrap)) return bootstrap;

    const history = await readPlayerHistory(previousSeasonName());
    if (history.size === 0) {
      console.warn(
        "[fpl] season totals are zeroed and no history is stored — every " +
          "projection will fall back to a price prior. Run /api/cron/history.",
      );
      return bootstrap;
    }

    const { bootstrap: restored, restored: count } = applyLastSeason(
      bootstrap,
      history,
    );
    console.info(`[fpl] season totals zeroed; restored ${count} players from history`);
    return restored;
  });
}

/**
 * The season whose totals we fall back on, as FPL labels it ("2025/26").
 *
 * Derived from the calendar rather than stored: a Premier League season starts
 * in August, so before then the current label still belongs to the previous
 * campaign.
 */
export function previousSeasonName(now = new Date()): string {
  const year = now.getUTCFullYear();
  const startYear = now.getUTCMonth() >= 6 ? year - 1 : year - 2;
  return `${startYear}/${String((startYear + 1) % 100).padStart(2, "0")}`;
}

/** All 380 fixtures with per-team FDR. Changes rarely; cached for 6h. */
export function getFixtures(): Promise<FplFixture[]> {
  return cached("fixtures", 21_600, () =>
    readThrough("fixtures", 21_600, getFixturesLive),
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

/**
 * The most recent gameweek whose deadline has passed, or null before the first
 * deadline of a season.
 *
 * This is deliberately NOT the gameweek being analysed. A manager's picks are
 * published only once a deadline locks them, so the squad you own right now is
 * the one from the last locked gameweek, while the gameweek you want advice
 * about is the next one. Asking FPL for the picks of the gameweek being
 * analysed asks for the one set of picks guaranteed not to exist yet.
 */
export function resolvePicksGameweek(bootstrap: FplBootstrap): number | null {
  const now = Date.now();
  const passed = bootstrap.events
    .filter((e) => Date.parse(e.deadline_time) <= now)
    .sort((a, b) => b.id - a.id);
  return passed[0]?.id ?? null;
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

/**
 * A player's season-by-season history.
 *
 * The only place FPL still exposes last season once the new one starts — the
 * bootstrap totals are zeroed at the first deadline. One request per player, so
 * callers should persist the result rather than fetch it per projection.
 */
export function getElementSummary(playerId: number): Promise<FplElementSummary> {
  return cached(`element-summary:${playerId}`, 86_400, () =>
    get<FplElementSummary>(`/element-summary/${playerId}/`),
  );
}
