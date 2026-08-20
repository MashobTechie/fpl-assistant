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

/** FPL squad composition: exactly this many of each position. */
export const SQUAD_QUOTA: Record<PlayerListItem["position"], number> = {
  GKP: 2,
  DEF: 5,
  MID: 5,
  FWD: 3,
};

export const SQUAD_BUDGET = 100.0;
