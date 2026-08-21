/**
 * Types for the (undocumented, unofficial) Fantasy Premier League JSON API.
 * Only the fields we actually consume are modelled — the real payloads carry
 * far more. Shapes verified against live data on 2026-08-20.
 */

export type ElementTypeId = 1 | 2 | 3 | 4; // GKP, DEF, MID, FWD

/** `status` on an element. Anything other than "a" carries availability risk. */
export type PlayerStatus =
  | "a" // available
  | "d" // doubtful
  | "i" // injured
  | "s" // suspended
  | "u" // unavailable
  | "n"; // not in squad

export interface FplTeam {
  id: number;
  name: string;
  short_name: string;
  /**
   * 1–5 overall strength. Note: the granular `strength_attack_*` /
   * `strength_defence_*` fields are all zero during pre-season, so the
   * projection engine leans on per-fixture FDR instead of these.
   */
  strength_overall_home: number;
  strength_overall_away: number;
  strength_attack_home: number;
  strength_attack_away: number;
  strength_defence_home: number;
  strength_defence_away: number;
}

export interface FplElement {
  id: number;
  code: number;
  web_name: string;
  first_name: string;
  second_name: string;
  team: number;
  element_type: ElementTypeId;
  /** Price in tenths of a million: 155 => £15.5m. */
  now_cost: number;
  status: PlayerStatus;
  /** 0–100, or null when FPL has published no doubt. */
  chance_of_playing_next_round: number | null;
  news: string;

  // Season totals. During pre-season these hold LAST season's numbers for
  // returning players and zeroes for players new to the league.
  minutes: number;
  starts: number;
  total_points: number;
  goals_scored: number;
  assists: number;
  clean_sheets: number;
  saves: number;
  bonus: number;
  bps: number;
  defensive_contribution: number;

  // Per-90 rates (strings in the payload — FPL sends decimals as strings).
  expected_goals_per_90: number;
  expected_assists_per_90: number;
  expected_goals_conceded_per_90: number;
  saves_per_90: number;
  starts_per_90: number;
  defensive_contribution_per_90: number;

  // String-encoded decimals.
  form: string;
  points_per_game: string;
  selected_by_percent: string;
  ep_next: string;
  expected_goals: string;
  expected_assists: string;

  /** Set-piece order; 1 = first choice. null when not on them. */
  penalties_order: number | null;
  corners_and_indirect_freekicks_order: number | null;
  direct_freekicks_order: number | null;

  // ---------------------------------------------------------- price movement
  //
  // All in tenths of a million, matching now_cost. A player's price moves with
  // net transfer flow, so holding a riser before it rises is worth real team
  // value over a season — and selling after a fall crystallises the loss.

  /** Price change during the current gameweek. Negative for a fall. */
  cost_change_event: number;
  /** Price change since the season started. Negative for a fall. */
  cost_change_start: number;
  /** Falls only, as a positive number. */
  cost_change_event_fall: number;
  cost_change_start_fall: number;

  /** Net transfer flow, which is what actually drives a price change. */
  transfers_in_event: number;
  transfers_out_event: number;

  /**
   * FPL's own forward-looking price forecast — one entry per day ahead.
   * `offset` 0 is tonight's change. Present but all-zero before the season's
   * first deadline, and while `price_change_calibrating` is true.
   */
  price_change_projections: {
    offset: number;
    projected_percent: string;
    likelihood: number;
  }[];
  /** Percentage progress toward the next change; "100" triggers it. */
  price_change_percent: string;
  price_change_hourly_rate: number;
  /** ISO timestamp, or null. Price cannot move before this. */
  price_change_locked_until: string | null;
  /** True early in a season, while FPL has too little flow data to forecast. */
  price_change_calibrating: boolean;
}

export interface FplEvent {
  id: number;
  name: string;
  deadline_time: string;
  finished: boolean;
  is_current: boolean;
  is_next: boolean;
  is_previous: boolean;
}

export interface FplElementType {
  id: ElementTypeId;
  singular_name_short: string; // GKP | DEF | MID | FWD
}

export interface FplBootstrap {
  events: FplEvent[];
  teams: FplTeam[];
  elements: FplElement[];
  element_types: FplElementType[];
}

export interface FplFixture {
  id: number;
  /** null for fixtures not yet assigned to a gameweek. */
  event: number | null;
  finished: boolean;
  kickoff_time: string | null;
  team_h: number;
  team_a: number;
  /** FDR 1–5, from the perspective of the named team. */
  team_h_difficulty: number;
  team_a_difficulty: number;
}

/** A manager's picks for one gameweek: /api/entry/{id}/event/{gw}/picks/ */
export interface FplPicks {
  picks: Array<{
    element: number;
    position: number; // 1–15; 1–11 started, 12–15 bench in order
    multiplier: number; // 0 benched, 1 played, 2 captain, 3 triple captain
    is_captain: boolean;
    is_vice_captain: boolean;
    /**
     * What this player would actually raise if sold, in tenths of a million.
     *
     * Not the same as now_cost. FPL returns only half of any rise since
     * purchase, rounded down, so a player bought at £7.0m and now worth £7.5m
     * sells for £7.2m. Transfer advice that assumes the market price is advice
     * that does not add up. Absent on older payloads, so callers fall back to
     * current cost.
     */
    selling_price?: number;
    purchase_price?: number;
  }>;
  entry_history: {
    event: number;
    bank: number; // tenths of a million
    value: number; // squad value incl. bank
    event_transfers: number;
    event_transfers_cost?: number; // points deducted for extra transfers
  };
}

/** Manager metadata: /api/entry/{id}/ */
export interface FplEntry {
  id: number;
  name: string; // team name
  player_first_name: string;
  player_last_name: string;
  summary_overall_points: number | null;
  summary_overall_rank: number | null;
}

export const POSITION_NAME: Record<ElementTypeId, "GKP" | "DEF" | "MID" | "FWD"> = {
  1: "GKP",
  2: "DEF",
  3: "MID",
  4: "FWD",
};
