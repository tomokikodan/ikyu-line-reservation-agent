import { describe, expect, it } from "vitest";
import { extractBookingRank, isBookingRequest, normalizeIntent } from "../src/services/intent.js";

describe("intent helpers", () => {
  it("computes missing required reservation fields", () => {
    const intent = normalizeIntent({
      date: "2026-06-01",
      time: "19:00",
      preferences: [],
      missingFields: [],
      originalText: "銀座で予約"
    });

    expect(intent.missingFields).toEqual(["partySize", "area"]);
  });

  it("extracts a candidate rank from booking text", () => {
    expect(extractBookingRank("２番を予約したい")).toBe(2);
    expect(extractBookingRank("予約したい")).toBeUndefined();
    expect(isBookingRequest("予約に進みたい")).toBe(true);
  });
});
