import { describe, expect, it, vi } from "vitest";
import { JobQueue } from "../src/services/jobQueue.js";
import type { LineClient, LineMessage } from "../src/line/client.js";
import type { AiService } from "../src/openai/service.js";
import type { Candidate, ReservationIntent, SearchJob } from "../src/types.js";

class FakeLine implements LineClient {
  pushes: Array<{ to: string; messages: LineMessage[] }> = [];

  async reply(): Promise<void> {
    throw new Error("not used");
  }

  async push(to: string, messages: LineMessage[]): Promise<void> {
    this.pushes.push({ to, messages });
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

describe("JobQueue", () => {
  it("falls back to extracted candidates when OpenAI ranking returns none", async () => {
    const intent: ReservationIntent = {
      date: "2026-05-25",
      time: "19:00",
      partySize: 2,
      area: "豊田市",
      genre: "ワイン",
      preferences: [],
      missingFields: [],
      originalText: "明日の豊田市付近でワインの飲めるお店"
    };
    const extracted: Candidate[] = [
      {
        name: "テストワイン食堂",
        url: "https://restaurant.ikyu.com/123456/",
        availability: "不明",
        price: "5,000円",
        genre: "ワインバー",
        area: "豊田"
      }
    ];
    const saved: Candidate[] = [{ ...extracted[0], rank: 1, evaluationReason: "豊田市周辺の候補、ワイン条件に関連" }];
    const line = new FakeLine();
    const repos = {
      updateSearchJob: vi.fn(async () => undefined),
      appendAuditLog: vi.fn(async () => undefined),
      saveRankedCandidates: vi.fn(async () => saved),
      updateConversation: vi.fn(async () => undefined),
      appendMessage: vi.fn(async () => undefined)
    };
    const ai: AiService = {
      extractIntent: vi.fn(),
      rankCandidates: vi.fn(async () => [])
    };
    const ikyu = {
      search: vi.fn(async () => ({ candidates: extracted })),
      prepareBooking: vi.fn()
    };
    const queue = new JobQueue({
      repos: repos as never,
      ai,
      line,
      ikyu: ikyu as never,
      maxConcurrency: 1
    });
    const job: SearchJob = { id: "job-1", lineUserId: "U1", status: "queued", intent };

    queue.enqueueSearch(job);
    await sleep(20);

    expect(repos.saveRankedCandidates).toHaveBeenCalledWith(
      "job-1",
      expect.arrayContaining([expect.objectContaining({ name: "テストワイン食堂", rank: 1 })])
    );
    expect(line.pushes.at(-1)?.messages[0].text).toContain("テストワイン食堂");
  });
});
