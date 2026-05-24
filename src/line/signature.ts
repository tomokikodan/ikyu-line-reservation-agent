import { createHmac, timingSafeEqual } from "node:crypto";

export function verifyLineSignature(body: Buffer, channelSecret: string, signature?: string): boolean {
  if (!signature) return false;
  const digest = createHmac("sha256", channelSecret).update(body).digest("base64");
  const expected = Buffer.from(digest);
  const actual = Buffer.from(signature);
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}
