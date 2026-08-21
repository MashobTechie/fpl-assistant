/**
 * The reasoning layer.
 *
 * This module turns computed projections into an explained recommendation. It
 * does not compute anything itself — if a number appears in the output, it came
 * from the projection engine.
 */

import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";

import { GameweekAnalysisSchema, type GameweekAnalysis } from "./schema";
import {
  ANALYST_SYSTEM_PROMPT,
  buildAnalysisPrompt,
  type AnalysisRequest,
} from "./prompts";

/**
 * Built on first use, not at module load.
 *
 * The constructor reads the API key once and keeps it. Building it at module
 * scope meant the key was captured the first time this file was imported — so
 * editing .env.local mid-session left a client holding the old value, and the
 * next request failed with "missing or invalid key" while the new key sat in
 * the environment working perfectly. Resolving lazily makes an env change take
 * effect on the next call.
 *
 * Resolves ANTHROPIC_API_KEY, ANTHROPIC_AUTH_TOKEN, or a local `ant` profile.
 */
let cachedClient: Anthropic | null = null;
let cachedKey: string | undefined;

function getClient(): Anthropic {
  const key = process.env.ANTHROPIC_API_KEY;
  if (!cachedClient || cachedKey !== key) {
    cachedClient = new Anthropic();
    cachedKey = key;
  }
  return cachedClient;
}

/**
 * Opus 5 is the default because reasoning quality is the product. Override with
 * ANTHROPIC_MODEL while developing to cut cost: claude-haiku-4-5 is roughly a
 * seventh of the price and fine for exercising the wiring, though the analysis
 * is visibly shallower. Ship on Opus.
 */
const MODEL = process.env.ANTHROPIC_MODEL ?? "claude-opus-5";

export class AnalystError extends Error {
  constructor(
    message: string,
    readonly retryable: boolean,
  ) {
    super(message);
    this.name = "AnalystError";
  }
}

export async function analyseGameweek(
  req: AnalysisRequest,
): Promise<GameweekAnalysis> {
  try {
    const response = await getClient().messages.parse({
      model: MODEL,
      max_tokens: 16000,
      // Adaptive thinking: this is a genuine reasoning task, and the model
      // decides how much depth each squad warrants.
      thinking: { type: "adaptive" },
      // The system prompt never varies, so it stays a warm cache prefix.
      system: [
        {
          type: "text",
          text: ANALYST_SYSTEM_PROMPT,
          cache_control: { type: "ephemeral" },
        },
      ],
      messages: [{ role: "user", content: buildAnalysisPrompt(req) }],
      output_config: { format: zodOutputFormat(GameweekAnalysisSchema) },
    });

    if (response.stop_reason === "refusal") {
      throw new AnalystError(
        "The analyst declined to answer this request.",
        false,
      );
    }
    if (response.stop_reason === "max_tokens") {
      throw new AnalystError(
        "Analysis was cut off before completing. Try a shorter horizon.",
        true,
      );
    }

    const parsed = response.parsed_output;
    if (!parsed) {
      throw new AnalystError(
        "The analyst returned a response that did not match the expected format.",
        true,
      );
    }
    return parsed;
  } catch (err) {
    if (err instanceof AnalystError) throw err;

    // Most specific first — the distinction that matters is retryable or not.
    if (err instanceof Anthropic.RateLimitError) {
      throw new AnalystError("Rate limited by the Claude API. Try again shortly.", true);
    }
    if (err instanceof Anthropic.AuthenticationError) {
      throw new AnalystError("ANTHROPIC_API_KEY is missing or invalid.", false);
    }
    if (err instanceof Anthropic.BadRequestError) {
      throw new AnalystError(`Malformed request to the Claude API: ${err.message}`, false);
    }
    if (err instanceof Anthropic.APIConnectionError) {
      throw new AnalystError("Could not reach the Claude API.", true);
    }
    if (err instanceof Anthropic.InternalServerError) {
      throw new AnalystError("The Claude API is having trouble. Try again shortly.", true);
    }
    if (err instanceof Anthropic.APIError) {
      throw new AnalystError(`Claude API error: ${err.message}`, false);
    }
    throw err;
  }
}
