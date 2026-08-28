/**
 * The shape the analyst must return.
 *
 * Structured output is what keeps the reasoning layer honest: the model fills
 * in judgement and explanation, but it cannot restructure the answer, skip the
 * reasoning field, or return prose where a player id belongs.
 */

import { z } from "zod";

const PlayerRef = z.object({
  playerId: z.number().describe("FPL element id, copied exactly from the supplied data"),
  name: z.string(),
});

export const CaptainPickSchema = PlayerRef.extend({
  reasoning: z
    .string()
    .describe(
      "Why this player, citing the supplied projection numbers and fixture. Two or three sentences.",
    ),
  ceiling: z
    .string()
    .describe("The realistic best case for this pick, in FPL terms (e.g. 'brace plus bonus, 15+')"),
  risk: z.string().describe("The single most important thing that could go wrong"),
});

export const LineupChangeSchema = z.object({
  benchPlayerId: z.number(),
  benchPlayerName: z.string(),
  startPlayerId: z.number(),
  startPlayerName: z.string(),
  reasoning: z
    .string()
    .describe(
      "Why the projection-optimal lineup is wrong here — must cite something the model cannot see, such as a flagged injury, rotation pattern, or low-confidence data.",
    ),
});

export const RiskFlagSchema = z.object({
  playerId: z.number(),
  name: z.string(),
  severity: z.enum(["low", "medium", "high"]),
  issue: z.string().describe("The specific concern, not a generic warning"),
});

export const BoomCandidateSchema = PlayerRef.extend({
  reasoning: z.string().describe("Why the ceiling is higher than the projection suggests"),
});

export const TransferIdeaSchema = z.object({
  /**
   * Managers get one free transfer a week, so a list of three is only useful
   * ranked. Priority 1 is the move to make; the rest are what to do next week,
   * or with a hit if it is genuinely worth four points.
   */
  priority: z
    .number()
    .describe(
      "1 = make this first. Rank by value: a manager with one free transfer will only make number 1.",
    ),
  worthATake: z
    .boolean()
    .describe(
      "True only if this move justifies a -4 hit when no free transfer remains. Most do not.",
    ),
  /**
   * The outgoing player must be one of the target's supplied fundedBy entries.
   * Requiring it in the output is what stops a recommendation the manager
   * cannot actually execute — the constraint has to be answered, not assumed.
   */
  outPlayerId: z.number(),
  outName: z.string(),
  inPlayerId: z.number(),
  inName: z.string(),
  horizon: z.enum(["short_term", "medium_term"]),
  reasoning: z.string(),
  funding: z
    .string()
    .describe(
      "How the move is paid for, using only supplied figures: the outgoing player's selling price plus the bank against the incoming fee, and what is left over afterwards.",
    ),
  expectedGain: z
    .string()
    .describe("Projected points swing over the stated horizon, from the supplied numbers"),
});

export const ChipAdviceSchema = z.object({
  chip: z.enum(["bboost", "3xc", "freehit", "wildcard"]),
  recommendation: z
    .enum(["play_now", "hold"])
    .describe("play_now only when this specific gameweek is genuinely the right one."),
  reasoning: z
    .string()
    .describe(
      "Cite the supplied chip value. A chip is spent once, so holding is the default and playing needs a reason.",
    ),
});

export const GameweekAnalysisSchema = z.object({
  headline: z
    .string()
    .describe("One sentence an FPL manager could act on immediately. No filler."),
  confidence: z.enum(["high", "medium", "low"]),
  confidenceReasoning: z
    .string()
    .describe(
      "Why this confidence level, referencing the data basis and confidence scores supplied.",
    ),
  lineupVerdict: z
    .string()
    .describe("Assessment of the projection-optimal XI: what it gets right and what is close."),
  lineupChanges: z
    .array(LineupChangeSchema)
    .describe("Empty when the optimal XI should stand. Only override with a concrete reason."),
  captain: CaptainPickSchema,
  viceCaptain: CaptainPickSchema,
  benchOrderReasoning: z
    .string()
    .describe("Why the bench is ordered this way, focused on who is most likely to be needed."),
  boomCandidates: z.array(BoomCandidateSchema),
  risks: z.array(RiskFlagSchema),
  transferIdeas: z
    .array(TransferIdeaSchema)
    .describe(
      "Up to three, ranked with priority 1 first. The manager can normally make only one for free, so number 1 must be the single best move rather than the opening of a plan.",
    ),
  chipAdvice: z
    .array(ChipAdviceSchema)
    .describe(
      "One entry per chip still available. Default to hold — a chip spent this week cannot be spent in a better one.",
    ),
  keyTradeoff: z
    .string()
    .describe("The one real decision this gameweek hinges on, stated as a trade-off."),
});

export type GameweekAnalysis = z.infer<typeof GameweekAnalysisSchema>;
