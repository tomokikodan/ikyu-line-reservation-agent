import { requireEnv } from "../config.js";

export interface LineMessage {
  type: "text";
  text: string;
}

export interface LineClient {
  reply(replyToken: string, messages: LineMessage[]): Promise<void>;
  push(to: string, messages: LineMessage[]): Promise<void>;
}

export class HttpLineClient implements LineClient {
  async reply(replyToken: string, messages: LineMessage[]): Promise<void> {
    await this.request("https://api.line.me/v2/bot/message/reply", {
      replyToken,
      messages
    });
  }

  async push(to: string, messages: LineMessage[]): Promise<void> {
    await this.request("https://api.line.me/v2/bot/message/push", {
      to,
      messages
    });
  }

  private async request(url: string, body: unknown): Promise<void> {
    const response = await fetch(url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${requireEnv("LINE_CHANNEL_ACCESS_TOKEN")}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify(body)
    });
    if (!response.ok) {
      const text = await response.text();
      throw new Error(`LINE API request failed: ${response.status} ${text}`);
    }
  }
}
