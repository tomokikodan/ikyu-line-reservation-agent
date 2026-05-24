import { config } from "../config.js";
import type { Repositories } from "../db/repositories.js";
import { formatSearchStarted, questionForMissingField } from "../line/messages.js";
import type { LineClient } from "../line/client.js";
import type { AiService } from "../openai/service.js";
import type { ReservationIntent } from "../types.js";
import type { JobQueue } from "./jobQueue.js";
import { extractBookingRank, isBookingRequest, mergeIntent, normalizeIntent } from "./intent.js";

export class ConversationService {
  constructor(
    private readonly deps: {
      repos: Repositories;
      ai: AiService;
      line: LineClient;
      jobs: JobQueue;
    }
  ) {}

  async handleText(input: {
    lineUserId: string;
    replyToken: string;
    text: string;
    rawPayload?: unknown;
  }): Promise<void> {
    await this.deps.repos.appendMessage({
      lineUserId: input.lineUserId,
      direction: "inbound",
      messageType: "text",
      text: input.text,
      rawPayload: input.rawPayload
    });

    const conversation = await this.deps.repos.getConversation(input.lineUserId);

    if (isBookingRequest(input.text)) {
      await this.handleBookingRequest(input.lineUserId, input.replyToken, input.text, conversation.intent);
      return;
    }

    const extracted = await this.deps.ai.extractIntent({
      text: input.text,
      previousIntent: conversation.intent,
      nowIso: new Date().toISOString()
    });
    const intent = mergeIntent(conversation.intent, normalizeIntent(extracted));
    const missing = intent.missingFields[0];

    if (missing) {
      await this.deps.repos.updateConversation({
        lineUserId: input.lineUserId,
        status: "collecting_missing_info",
        intent,
        pendingField: missing,
        lastSearchJobId: conversation.lastSearchJobId
      });
      const text = questionForMissingField(missing);
      await this.deps.line.reply(input.replyToken, [{ type: "text", text }]);
      await this.deps.repos.appendMessage({
        lineUserId: input.lineUserId,
        direction: "outbound",
        messageType: "text",
        text
      });
      return;
    }

    const job = await this.deps.repos.createSearchJob(input.lineUserId, intent);
    await this.deps.repos.updateConversation({
      lineUserId: input.lineUserId,
      status: "searching",
      intent,
      lastSearchJobId: job.id
    });

    const replyText = formatSearchStarted(intent);
    await this.deps.line.reply(input.replyToken, [{ type: "text", text: replyText }]);
    await this.deps.repos.appendMessage({
      lineUserId: input.lineUserId,
      direction: "outbound",
      messageType: "text",
      text: replyText
    });
    this.deps.jobs.enqueueSearch(job);
  }

  private async handleBookingRequest(
    lineUserId: string,
    replyToken: string,
    text: string,
    intent: unknown
  ): Promise<void> {
    const rank = extractBookingRank(text);
    if (!rank) {
      const reply = "どの候補を予約しますか？「1番を予約したい」のように番号で教えてください。";
      await this.deps.line.reply(replyToken, [{ type: "text", text: reply }]);
      await this.deps.repos.appendMessage({
        lineUserId,
        direction: "outbound",
        messageType: "text",
        text: reply
      });
      return;
    }

    const candidate = await this.deps.repos.getCandidateByJobRank(lineUserId, rank);
    if (!candidate) {
      const reply = "その番号の候補が見つかりませんでした。直近の候補から1〜5番で指定してください。";
      await this.deps.line.reply(replyToken, [{ type: "text", text: reply }]);
      return;
    }

    const previousIntent = intent as Partial<ReservationIntent>;
    const parsedIntent = normalizeIntent({
      ...previousIntent,
      originalText: previousIntent.originalText ?? text,
      preferences: previousIntent.preferences ?? []
    } as ReservationIntent);

    const reply = `${candidate.name} の予約画面を準備します。予約確定や個人情報入力は自動実行しません。`;
    await this.deps.line.reply(replyToken, [{ type: "text", text: reply }]);
    this.deps.jobs.enqueueBooking({
      lineUserId,
      candidate,
      intent: parsedIntent
    });

    if (config.NODE_ENV !== "test") {
      console.log(`Booking task queued for ${lineUserId}: candidate ${candidate.id}`);
    }
  }
}
