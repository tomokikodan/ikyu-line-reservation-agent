import express, { type Request, type Response } from "express";
import { config, requireEnv } from "./config.js";
import { Repositories } from "./db/repositories.js";
import { verifyLineSignature } from "./line/signature.js";
import type { LineClient } from "./line/client.js";
import { HttpLineClient } from "./line/client.js";
import { OpenAiService, type AiService } from "./openai/service.js";
import { IkyuRestaurantBrowser } from "./playwright/ikyu.js";
import { ConversationService } from "./services/conversation.js";
import { JobQueue } from "./services/jobQueue.js";
import { pool } from "./db/pool.js";

interface LineWebhookEvent {
  type: string;
  webhookEventId?: string;
  replyToken?: string;
  source?: {
    type: "user" | "group" | "room";
    userId?: string;
    groupId?: string;
    roomId?: string;
  };
  message?: {
    type: string;
    text?: string;
    mention?: {
      mentionees?: Array<{ isSelf?: boolean }>;
    };
  };
}

interface LineWebhookBody {
  destination?: string;
  events?: LineWebhookEvent[];
}

export function createApp(deps?: {
  repos?: Repositories;
  line?: LineClient;
  ai?: AiService;
  ikyu?: IkyuRestaurantBrowser;
}) {
  const app = express();
  const repos = deps?.repos ?? new Repositories(pool);
  const line = deps?.line ?? new HttpLineClient();
  const ai = deps?.ai ?? new OpenAiService();
  const ikyu = deps?.ikyu ?? new IkyuRestaurantBrowser();
  const jobs = new JobQueue({
    repos,
    line,
    ai,
    ikyu,
    maxConcurrency: config.MAX_SEARCH_CONCURRENCY
  });
  const conversation = new ConversationService({ repos, line, ai, jobs });

  app.get("/health", async (_req: Request, res: Response) => {
    try {
      await pool.query("SELECT 1");
      res.json({ ok: true });
    } catch (error) {
      res.status(503).json({ ok: false, error: error instanceof Error ? error.message : String(error) });
    }
  });

  app.post("/webhooks/line", express.raw({ type: "*/*" }), async (req: Request, res: Response) => {
    const body = req.body as Buffer;
    const channelSecret = requireEnv("LINE_CHANNEL_SECRET");
    const signature = req.header("x-line-signature") ?? undefined;

    if (!verifyLineSignature(body, channelSecret, signature)) {
      res.status(401).json({ ok: false });
      return;
    }

    let payload: LineWebhookBody;
    try {
      payload = JSON.parse(body.toString("utf8")) as LineWebhookBody;
    } catch {
      res.status(400).json({ ok: false, error: "Invalid JSON" });
      return;
    }

    res.status(200).json({ ok: true });

    for (const event of payload.events ?? []) {
      void handleEvent(event).catch(async (error) => {
        console.error("Failed to handle LINE event", error);
        await repos.appendAuditLog({
          eventType: "line_event_failed",
          details: { event, error: error instanceof Error ? error.message : String(error) }
        });
      });
    }
  });

  app.get("/admin/jobs/:id", express.json(), async (req: Request, res: Response) => {
    const queryToken = typeof req.query.token === "string" ? req.query.token : undefined;
    const token = req.header("authorization")?.replace(/^Bearer\s+/i, "") ?? queryToken;
    if (!config.ADMIN_TOKEN || token !== config.ADMIN_TOKEN) {
      res.status(401).json({ ok: false });
      return;
    }
    res.json(await repos.getJobReport(req.params.id));
  });

  async function handleEvent(event: LineWebhookEvent): Promise<void> {
    if (!event.webhookEventId || !event.replyToken) return;

    const userId = event.source?.userId;
    if (!userId) return;

    const firstSeen = await repos.recordProcessedEvent(event.webhookEventId, userId);
    if (!firstSeen) return;

    if (event.type !== "message" || event.message?.type !== "text" || !event.message.text) {
      await repos.appendAuditLog({
        lineUserId: userId,
        eventType: "ignored_line_event",
        details: { reason: "unsupported_event", event }
      });
      return;
    }

    if (event.source?.type !== "user" && !event.message.mention?.mentionees?.some((item) => item.isSelf)) {
      await repos.appendAuditLog({
        lineUserId: userId,
        eventType: "ignored_line_event",
        details: { reason: "group_without_mention", event }
      });
      return;
    }

    await conversation.handleText({
      lineUserId: userId,
      replyToken: event.replyToken,
      text: event.message.text,
      rawPayload: event
    });
  }

  return app;
}
