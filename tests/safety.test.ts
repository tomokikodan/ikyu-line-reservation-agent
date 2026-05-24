import { describe, expect, it } from "vitest";
import { detectUnsafeBookingText } from "../src/playwright/safety.js";

describe("booking safety guard", () => {
  it("stops before booking confirmation", () => {
    expect(detectUnsafeBookingText("内容を確認して予約を確定してください")).toContain("予約確定");
  });

  it("stops before payment or personal information entry", () => {
    expect(detectUnsafeBookingText("氏名と電話番号を入力してください")).toContain("個人情報");
    expect(detectUnsafeBookingText("クレジットカード番号を入力してください")).toContain("決済");
  });

  it("allows neutral text", () => {
    expect(detectUnsafeBookingText("日時と人数を選択してください")).toBeUndefined();
  });
});
