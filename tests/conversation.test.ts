import { describe, expect, it, vi } from "vitest";
import { ConversationService } from "../src/services/conversation.js";
import type { AiService } from "../src/openai/service.js";
import type { LineClient, LineMessage } from "../src/line/client.js";
import type { ReservationIntent } from "../src/types.js";

class FakeLine implements LineClient {
  replies: Array<{ token: string; messages: LineMessage[] }> = [];
  pushes: Array<{ to: string; messages: LineMessage[] }> = [];

  async reply(replyToken: string, messages: LineMessage[]): Promise<void> {
    this.replies.push({ token: replyToken, messages });
  }

  async push(to: string, messages: LineMessage[]): Promise<void> {
    this.pushes.push({ to, messages });
  }
}

function fakeRepos() {
  const conversation = {
    lineUserId: "U1",
    status: "idle",
    intent: {},
    lastSearchJobId: undefined
  };
  return {
    appendMessage: vi.fn(async () => undefined),
    getConversation: vi.fn(async () => conversation),
    updateConversation: vi.fn(async (input) => ({ ...conversation, ...input })),
    createSearchJob: vi.fn(async (_lineUserId: string, intent: ReservationIntent) => ({
      id: "job-1",
      lineUserId: "U1",
      status: "queued",
      intent
    })),
    getCandidateByJobRank: vi.fn(async () => undefined)
  };
}

describe("ConversationService", () => {
  it("asks for missing required fields before search", async () => {
    const repos = fakeRepos();
    const line = new FakeLine();
    const ai: AiService = {
      extractIntent: vi.fn(async () => ({
        date: "2026-06-01",
        time: "19:00",
        preferences: [],
        missingFields: ["partySize", "area"],
        originalText: "銀座で"
      })),
      rankCandidates: vi.fn()
    };
    const jobs = { enqueueSearch: vi.fn(), enqueueBooking: vi.fn() };
    const service = new ConversationService({ repos: repos as never, line, ai, jobs: jobs as never });

    await service.handleText({ lineUserId: "U1", replyToken: "reply", text: "銀座で" });

    expect(line.replies[0].messages[0].text).toContain("人数");
    expect(jobs.enqueueSearch).not.toHaveBeenCalled();
  });

  it("queues search when all required fields are present", async () => {
    const repos = fakeRepos();
    const line = new FakeLine();
    const ai: AiService = {
      extractIntent: vi.fn(async () => ({
        date: "2026-06-01",
        time: "19:00",
        partySize: 2,
        area: "銀座",
        preferences: [],
        missingFields: [],
        originalText: "銀座で2名"
      })),
      rankCandidates: vi.fn()
    };
    const jobs = { enqueueSearch: vi.fn(), enqueueBooking: vi.fn() };
    const service = new ConversationService({ repos: repos as never, line, ai, jobs: jobs as never });

    await service.handleText({ lineUserId: "U1", replyToken: "reply", text: "銀座で2名" });

    expect(line.replies[0].messages[0].text).toContain("検索します");
    expect(jobs.enqueueSearch).toHaveBeenCalledWith(expect.objectContaining({ id: "job-1" }));
  });

  it("requires a candidate number for booking", async () => {
    const repos = fakeRepos();
    const line = new FakeLine();
    const ai: AiService = { extractIntent: vi.fn(), rankCandidates: vi.fn() };
    const jobs = { enqueueSearch: vi.fn(), enqueueBooking: vi.fn() };
    const service = new ConversationService({ repos: repos as never, line, ai, jobs: jobs as never });

    await service.handleText({ lineUserId: "U1", replyToken: "reply", text: "予約したい" });

    expect(line.replies[0].messages[0].text).toContain("番号");
    expect(jobs.enqueueBooking).not.toHaveBeenCalled();
  });
});
