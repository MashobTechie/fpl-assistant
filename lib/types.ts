/** Shapes shared between the API routes and the client components. */

import type { GameweekAnalysis } from "@/lib/ai/schema";
import type { PlayerProjection } from "@/lib/projections/engine";
import type { OptimisedSquad } from "@/lib/squad/optimizer";

export interface PlayerListItem {
  id: number;
  name: string;
  position: "GKP" | "DEF" | "MID" | "FWD";
  team: string;
  cost: number;
  status: string;
  gw: number;
  horizon: number;
  minutes: number;
  confidence: number;
  basis: string;
  ppm: number;
  fixtures: { opponent: string; home: boolean; fdr: number }[];
  risks: string[];
}

export interface PlayersResponse {
  gameweek: number;
  players: PlayerListItem[];
}

export interface AnalysisResponse {
  gameweek: number;
  horizon: number;
  squad: PlayerProjection[];
  optimal: OptimisedSquad;
  analysis: GameweekAnalysis;
  cached: boolean;
  generatedAt: string;
}

// ------------------------------------------------------------- squad rules
//
// The single source of truth for FPL's squad-legality rules. The picker
// (client) and the validator (server) both read these, so the two can never
// drift: a rule enforced only in the browser is not enforced at all.

export const SQUAD_SIZE = 15;

/** FPL squad composition: exactly this many of each position. */
export const SQUAD_QUOTA: Record<PlayerListItem["position"], number> = {
  GKP: 2,
  DEF: 5,
  MID: 5,
  FWD: 3,
};

/**
 * The £100.0m ceiling applies when *buying* a squad, not to one already owned.
 * A real squad legitimately drifts above it as prices rise — that is the reward
 * for early picks — so this is checked for manually built squads only, never
 * for an imported one. See validateSquadComposition.
 */
export const SQUAD_BUDGET = 100.0;

/** At most three players from any one Premier League club. */
export const MAX_PER_CLUB = 3;
