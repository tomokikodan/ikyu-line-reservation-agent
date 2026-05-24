import { z } from "zod";

export const MissingFieldSchema = z.enum(["date", "time", "partySize", "area"]);

export const ReservationIntentSchema = z.object({
  date: z.string().optional(),
  time: z.string().optional(),
  partySize: z.number().int().positive().optional(),
  area: z.string().optional(),
  genre: z.string().optional(),
  occasion: z.string().optional(),
  budgetPerPerson: z.number().int().positive().optional(),
  preferences: z.array(z.string()).default([]),
  missingFields: z.array(MissingFieldSchema).default([]),
  originalText: z.string()
});

export const CandidateSchema = z.object({
  name: z.string().min(1),
  url: z.string().url(),
  availability: z.string().default("不明"),
  price: z.string().optional(),
  genre: z.string().optional(),
  area: z.string().optional(),
  extractionNote: z.string().optional()
});

export const RankedCandidateSchema = CandidateSchema.extend({
  rank: z.number().int().min(1).max(5),
  evaluationReason: z.string().min(1)
});

export const RankedCandidatesSchema = z.object({
  candidates: z.array(RankedCandidateSchema).min(0).max(5)
});
