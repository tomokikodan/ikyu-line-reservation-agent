import type { MissingField, ReservationIntent } from "../types.js";

const requiredFields: MissingField[] = ["date", "time", "partySize", "area"];

export function normalizeIntent(intent: ReservationIntent): ReservationIntent {
  const missingFields = requiredFields.filter((field) => {
    const value = intent[field];
    return value === undefined || value === null || value === "";
  });

  return {
    ...intent,
    preferences: intent.preferences ?? [],
    missingFields
  };
}

export function mergeIntent(
  previous: Partial<ReservationIntent>,
  next: ReservationIntent
): ReservationIntent {
  return normalizeIntent({
    ...previous,
    ...next,
    preferences: Array.from(new Set([...(previous.preferences ?? []), ...(next.preferences ?? [])])),
    originalText: next.originalText
  } as ReservationIntent);
}

export function extractBookingRank(text: string): number | undefined {
  const normalized = text.replace(/[０-９]/g, (char) => String.fromCharCode(char.charCodeAt(0) - 0xfee0));
  const match = normalized.match(/([1-5])\s*番.*予約|予約.*([1-5])\s*番/);
  const value = match?.[1] ?? match?.[2];
  return value ? Number(value) : undefined;
}

export function isBookingRequest(text: string): boolean {
  return /予約したい|予約に進|予約する/.test(text);
}
