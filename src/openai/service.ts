import OpenAI from "openai";
import { zodTextFormat } from "openai/helpers/zod";
import { config, requireEnv } from "../config.js";
import { CandidateSchema, RankedCandidatesSchema, ReservationIntentSchema } from "../schemas.js";
import type { Candidate, RankedCandidate, ReservationIntent } from "../types.js";

export interface AiService {
  extractIntent(input: {
    text: string;
    previousIntent?: Partial<ReservationIntent>;
    nowIso: string;
  }): Promise<ReservationIntent>;
  rankCandidates(input: {
    intent: ReservationIntent;
    candidates: Candidate[];
  }): Promise<RankedCandidate[]>;
}

export class OpenAiService implements AiService {
  private readonly client = new OpenAI({
    apiKey: requireEnv("OPENAI_API_KEY")
  });

  async extractIntent(input: {
    text: string;
    previousIntent?: Partial<ReservationIntent>;
    nowIso: string;
  }): Promise<ReservationIntent> {
    const response = await this.client.responses.parse({
      model: config.OPENAI_MODEL,
      input: [
        {
          role: "system",
          content:
            "You extract restaurant reservation requirements from Japanese LINE messages. Return only facts stated or strongly implied. Dates must be normalized to YYYY-MM-DD in Asia/Tokyo when possible. Times must be HH:mm. Required fields are date, time, partySize, area. Add missing required fields to missingFields. Keep preferences as concise Japanese strings."
        },
        {
          role: "user",
          content: JSON.stringify({
            nowIso: input.nowIso,
            previousIntent: input.previousIntent ?? {},
            message: input.text
          })
        }
      ],
      text: {
        format: zodTextFormat(ReservationIntentSchema, "reservation_intent")
      }
    });

    return ReservationIntentSchema.parse({
      ...response.output_parsed,
      originalText: input.text
    });
  }

  async rankCandidates(input: {
    intent: ReservationIntent;
    candidates: Candidate[];
  }): Promise<RankedCandidate[]> {
    if (input.candidates.length === 0) return [];

    const sanitized = input.candidates.map((candidate) => CandidateSchema.parse(candidate));
    const response = await this.client.responses.parse({
      model: config.OPENAI_MODEL,
      input: [
        {
          role: "system",
          content:
            "You rank restaurant candidates for a reservation request. Use only provided candidate facts. Do not invent availability, prices, ratings, areas, genres, or URLs. Choose at most five. Write short Japanese evaluation reasons."
        },
        {
          role: "user",
          content: JSON.stringify({
            intent: input.intent,
            candidates: sanitized
          })
        }
      ],
      text: {
        format: zodTextFormat(RankedCandidatesSchema, "ranked_candidates")
      }
    });

    return RankedCandidatesSchema.parse(response.output_parsed).candidates;
  }
}
