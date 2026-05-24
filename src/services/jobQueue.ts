import type { Repositories } from "../db/repositories.js";
import { formatBookingHandoff, formatCandidates, formatSearchProgress } from "../line/messages.js";
import type { LineClient } from "../line/client.js";
import type { AiService } from "../openai/service.js";
import type { IkyuRestaurantBrowser } from "../playwright/ikyu.js";
import type { Candidate, ReservationIntent, SearchJob, SearchProgress } from "../types.js";

interface SearchTask {
  job: SearchJob;
}

interface BookingTask {
  lineUserId: string;
  candidate: Candidate;
  intent: ReservationIntent;
}

const SEARCH_PROGRESS_PUSH_INTERVAL_MS = 60_000;

export class JobQueue {
  private readonly searchQueue: SearchTask[] = [];
  private readonly bookingQueue: BookingTask[] = [];
  private readonly lastProgressPushedAt = new Map<string, number>();
  private running = 0;

  constructor(
    private readonly deps: {
      repos: Repositories;
      ai: AiService;
      line: LineClient;
      ikyu: IkyuRestaurantBrowser;
      maxConcurrency: number;
    }
  ) {}

  enqueueSearch(job: SearchJob): void {
    this.searchQueue.push({ job });
    void this.drain();
  }

  enqueueBooking(task: BookingTask): void {
    this.bookingQueue.push(task);
    void this.drain();
  }

  private async drain(): Promise<void> {
    while (this.running < this.deps.maxConcurrency) {
      const task = this.searchQueue.shift() ?? this.bookingQueue.shift();
      if (!task) return;

      this.running += 1;
      void this.runTask(task)
        .catch((error) => {
          console.error("Background task failed", error);
        })
        .finally(() => {
          this.running -= 1;
          void this.drain();
        });
    }
  }

  private async runTask(task: SearchTask | BookingTask): Promise<void> {
    if ("job" in task) {
      await this.runSearch(task.job);
      return;
    }
    await this.runBooking(task);
  }

  private async runSearch(job: SearchJob): Promise<void> {
    await this.deps.repos.updateSearchJob({ id: job.id, status: "running" });
    this.lastProgressPushedAt.set(job.id, Date.now());
    await this.deps.repos.appendAuditLog({
      lineUserId: job.lineUserId,
      eventType: "search_started",
      details: { jobId: job.id, intent: job.intent }
    });

    try {
      const searchResult = await this.deps.ikyu.search(job.intent, job.id, async (progress) => {
        await this.pushSearchProgress(job, progress);
      });
      await this.pushSearchProgress(job, {
        stage: "candidate_ranking",
        message: `${searchResult.candidates.length}件の候補を取得しました。OpenAIで条件に合う5件へ絞り込んでいます。`,
        details: { candidateCount: searchResult.candidates.length }
      });
      const ranked = await this.deps.ai.rankCandidates({
        intent: job.intent,
        candidates: searchResult.candidates
      });
      await this.pushSearchProgress(job, {
        stage: "reply_preparing",
        message: "候補の理由を整理して、LINE返信を作成しています。",
        details: { rankedCount: ranked.length }
      });
      const savedCandidates = await this.deps.repos.saveRankedCandidates(job.id, ranked);
      await this.deps.repos.updateSearchJob({ id: job.id, status: "completed" });
      await this.deps.repos.updateConversation({
        lineUserId: job.lineUserId,
        status: "presented_candidates",
        intent: job.intent,
        lastSearchJobId: job.id
      });
      await this.deps.line.push(job.lineUserId, [{ type: "text", text: formatCandidates(savedCandidates) }]);
      await this.deps.repos.appendAuditLog({
        lineUserId: job.lineUserId,
        eventType: "search_completed",
        details: { jobId: job.id, candidateCount: savedCandidates.length }
      });
    } catch (error) {
      const artifact = (error as { artifact?: unknown }).artifact;
      const message = error instanceof Error ? error.message : String(error);
      await this.deps.repos.updateSearchJob({
        id: job.id,
        status: "failed",
        errorReason: message,
        failureArtifact: artifact
      });
      await this.deps.line.push(job.lineUserId, [
        {
          type: "text",
          text: "一休レストラン検索で失敗しました。条件を少し変えて再検索できます。失敗理由はログに保存しました。"
        }
      ]);
      await this.deps.repos.appendAuditLog({
        lineUserId: job.lineUserId,
        eventType: "search_failed",
        details: { jobId: job.id, error: message, artifact }
      });
    } finally {
      this.lastProgressPushedAt.delete(job.id);
    }
  }

  private async pushSearchProgress(job: SearchJob, progress: SearchProgress): Promise<void> {
    const now = Date.now();
    const lastPushedAt = this.lastProgressPushedAt.get(job.id) ?? 0;
    if (now - lastPushedAt < SEARCH_PROGRESS_PUSH_INTERVAL_MS) {
      await this.deps.repos.appendAuditLog({
        lineUserId: job.lineUserId,
        eventType: "search_progress_skipped",
        details: { jobId: job.id, reason: "throttled", ...progress }
      });
      return;
    }
    this.lastProgressPushedAt.set(job.id, now);
    try {
      await this.deps.line.push(job.lineUserId, [{ type: "text", text: formatSearchProgress(progress) }]);
      await this.deps.repos.appendMessage({
        lineUserId: job.lineUserId,
        direction: "outbound",
        messageType: "text",
        text: formatSearchProgress(progress),
        rawPayload: { jobId: job.id, progress }
      });
      await this.deps.repos.appendAuditLog({
        lineUserId: job.lineUserId,
        eventType: "search_progress",
        details: { jobId: job.id, ...progress }
      });
    } catch (error) {
      console.warn("Failed to push search progress", error);
    }
  }

  private async runBooking(task: BookingTask): Promise<void> {
    const result = await this.deps.ikyu.prepareBooking(task.candidate, task.intent);
    await this.deps.repos.saveBookingAttempt({
      lineUserId: task.lineUserId,
      candidateId: task.candidate.id,
      result
    });
    await this.deps.repos.updateConversation({
      lineUserId: task.lineUserId,
      status: "booking_handoff",
      intent: task.intent,
      lastSearchJobId: undefined
    });
    await this.deps.line.push(task.lineUserId, [
      {
        type: "text",
        text: formatBookingHandoff(task.candidate.name, result.handoffUrl, result.stopReason)
      }
    ]);
    await this.deps.repos.appendAuditLog({
      lineUserId: task.lineUserId,
      eventType: "booking_handoff",
      details: { candidateId: task.candidate.id, status: result.status, stopReason: result.stopReason }
    });
  }
}
