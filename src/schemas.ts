import { z } from "zod";

export const MissingFieldSchema = z.enum(["date", "time", "partySize", "area"]);

export const ReservationIntentSchema = z.object({
  date: z.string().nullable(),
  time: z.string().nullable(),
  partySize: z.number().int().positive().nullable(),
  area: z.string().nullable(),
  genre: z.string().nullable(),
  occasion: z.string().nullable(),
  budgetPerPerson: z.number().int().positive().nullable(),
  preferences: z.array(z.string()),
  missingFields: z.array(MissingFieldSchema),
  originalText: z.string()
});

export const CandidateSchema = z.object({
  name: z.string().min(1),
  url: z.string().url(),
  availability: z.string(),
  price: z.string().nullable(),
  genre: z.string().nullable(),
  area: z.string().nullable(),
  extractionNote: z.string().nullable()
});

export const RankedCandidateSchema = CandidateSchema.extend({
  rank: z.number().int().min(1).max(5),
  evaluationReason: z.string().min(1)
});

export const RankedCandidatesSchema = z.object({
  candidates: z.array(RankedCandidateSchema).min(0).max(5)
});
