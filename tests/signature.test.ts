import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
import { verifyLineSignature } from "../src/line/signature.js";

describe("verifyLineSignature", () => {
  it("accepts a valid LINE webhook signature", () => {
    const body = Buffer.from(JSON.stringify({ events: [] }));
    const secret = "channel-secret";
    const signature = createHmac("sha256", secret).update(body).digest("base64");

    expect(verifyLineSignature(body, secret, signature)).toBe(true);
  });

  it("rejects an invalid signature", () => {
    const body = Buffer.from(JSON.stringify({ events: [] }));

    expect(verifyLineSignature(body, "channel-secret", "bad")).toBe(false);
  });
});
