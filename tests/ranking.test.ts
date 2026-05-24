import { describe, expect, it } from "vitest";
import { RankedCandidatesSchema } from "../src/schemas.js";

describe("ranked candidates schema", () => {
  it("accepts at most five ranked candidates", () => {
    const parsed = RankedCandidatesSchema.parse({
      candidates: [
        {
          rank: 1,
          name: "テスト",
          url: "https://restaurant.ikyu.com/123456/",
          availability: "空席あり",
          price: null,
          genre: null,
          area: null,
          extractionNote: null,
          evaluationReason: "条件に合う"
        }
      ]
    });

    expect(parsed.candidates).toHaveLength(1);
  });

  it("rejects invalid candidate URLs", () => {
    expect(() =>
      RankedCandidatesSchema.parse({
        candidates: [
          {
            rank: 1,
            name: "テスト",
            url: "not-a-url",
            availability: "空席あり",
            price: null,
            genre: null,
            area: null,
            extractionNote: null,
            evaluationReason: "条件に合う"
          }
        ]
      })
    ).toThrow();
  });
});
