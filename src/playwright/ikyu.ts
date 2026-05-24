import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { chromium, type Browser, type Page } from "playwright";
import { config } from "../config.js";
import type { BookingResult, Candidate, ReservationIntent, SearchProgress } from "../types.js";
import { detectUnsafeBookingText } from "./safety.js";

const IKYU_TOP_URL = "https://restaurant.ikyu.com/";
const ARTIFACT_DIR = "artifacts";

export interface IkyuSearchResult {
  candidates: Candidate[];
  artifact?: unknown;
}

export type SearchProgressReporter = (progress: SearchProgress) => Promise<void> | void;

export class IkyuRestaurantBrowser {
  async search(
    intent: ReservationIntent,
    jobId: string,
    onProgress?: SearchProgressReporter
  ): Promise<IkyuSearchResult> {
    await this.reportProgress(onProgress, {
      stage: "browser_launching",
      message: "検索用ブラウザを起動しています。Render無料プランではここで少し待つことがあります。"
    });
    const browser = await this.launch();
    const page = await browser.newPage({
      viewport: { width: 1365, height: 900 },
      locale: "ja-JP",
      timezoneId: "Asia/Tokyo"
    });

    try {
      page.setDefaultTimeout(config.SEARCH_TIMEOUT_MS);
      await this.reportProgress(onProgress, {
        stage: "site_opening",
        message: "一休レストランを開いています。"
      });
      await page.goto(IKYU_TOP_URL, { waitUntil: "domcontentloaded" });
      await this.acceptOptionalDialogs(page);
      await this.reportProgress(onProgress, {
        stage: "search_form_filling",
        message: "希望条件を一休レストランの検索画面に入力しています。"
      });
      await this.fillSearch(page, intent);
      await page.waitForLoadState("domcontentloaded");
      await page.waitForTimeout(1500);

      await this.reportProgress(onProgress, {
        stage: "candidate_extracting",
        message: "検索結果から店名、価格、エリア、空席情報を読み取っています。"
      });
      let candidates = await this.extractCandidates(page);
      if (candidates.length === 0) {
        await this.openKeywordSearch(page, intent);
        await page.waitForTimeout(1500);
        candidates = await this.extractCandidates(page);
      }
      if (candidates.length === 0) {
        const artifact = await this.saveFailureArtifact(page, jobId, "no_candidates");
        return { candidates: [], artifact };
      }

      return { candidates: candidates.slice(0, 20) };
    } catch (error) {
      const artifact = await this.saveFailureArtifact(page, jobId, "search_failed");
      throw Object.assign(error instanceof Error ? error : new Error(String(error)), { artifact });
    } finally {
      await browser.close();
    }
  }

  private async reportProgress(onProgress: SearchProgressReporter | undefined, progress: SearchProgress): Promise<void> {
    if (!onProgress) return;
    try {
      await onProgress(progress);
    } catch (error) {
      console.warn("Failed to report search progress", error);
    }
  }

  async prepareBooking(candidate: Candidate, intent: ReservationIntent): Promise<BookingResult> {
    const browser = await this.launch();
    const page = await browser.newPage({
      viewport: { width: 1365, height: 900 },
      locale: "ja-JP",
      timezoneId: "Asia/Tokyo"
    });

    try {
      page.setDefaultTimeout(config.SEARCH_TIMEOUT_MS);
      await page.goto(candidate.url, { waitUntil: "domcontentloaded" });
      await this.acceptOptionalDialogs(page);

      const unsafe = await this.detectUnsafeStep(page);
      if (unsafe) {
        return {
          status: "stopped_for_user",
          stopReason: unsafe,
          handoffUrl: page.url(),
          rawPayload: { candidate, intent }
        };
      }

      await this.trySelectReservationInputs(page, intent);
      const stopReason =
        (await this.detectUnsafeStep(page)) ??
        "予約確定、ログイン、個人情報入力、決済、キャンセル料同意が必要になる前の画面で停止しました。";

      return {
        status: "stopped_for_user",
        stopReason,
        handoffUrl: page.url(),
        rawPayload: { candidate, intent }
      };
    } catch (error) {
      return {
        status: "failed",
        stopReason: error instanceof Error ? error.message : String(error),
        handoffUrl: page.url(),
        rawPayload: { candidate, intent }
      };
    } finally {
      await browser.close();
    }
  }

  private async launch(): Promise<Browser> {
    return chromium.launch({
      headless: config.PLAYWRIGHT_HEADLESS,
      args: ["--no-sandbox", "--disable-dev-shm-usage"]
    });
  }

  private async acceptOptionalDialogs(page: Page): Promise<void> {
    const labels = ["同意", "閉じる", "許可しない", "あとで", "OK"];
    for (const label of labels) {
      const button = page.getByRole("button", { name: new RegExp(label) }).first();
      if (await button.isVisible().catch(() => false)) {
        await button.click().catch(() => undefined);
      }
    }
  }

  private async fillSearch(page: Page, intent: ReservationIntent): Promise<void> {
    await this.fillFirstVisible(page, [
      { selector: 'input[placeholder*="エリア"]', value: intent.area },
      { selector: 'input[placeholder*="店名"]', value: intent.area },
      { selector: 'input[type="search"]', value: [intent.area, intent.genre].filter(Boolean).join(" ") }
    ]);

    if (intent.date) {
      await this.fillFirstVisible(page, [
        { selector: 'input[name*="date"]', value: intent.date },
        { selector: 'input[placeholder*="日付"]', value: intent.date }
      ]);
    }

    if (intent.time) {
      await this.fillFirstVisible(page, [
        { selector: 'input[name*="time"]', value: intent.time },
        { selector: 'input[placeholder*="時間"]', value: intent.time }
      ]);
    }

    if (intent.partySize) {
      await this.fillFirstVisible(page, [
        { selector: 'input[name*="person"]', value: String(intent.partySize) },
        { selector: 'input[placeholder*="人数"]', value: String(intent.partySize) }
      ]);
    }

    const searchButton = page
      .getByRole("button", { name: /検索|空席|探す/ })
      .or(page.getByRole("link", { name: /検索|空席|探す/ }))
      .first();
    if (await searchButton.isVisible().catch(() => false)) {
      await Promise.all([
        page.waitForLoadState("domcontentloaded").catch(() => undefined),
        searchButton.click()
      ]);
      return;
    }

    const query = new URLSearchParams();
    const keyword = this.keywordForIntent(intent);
    if (keyword) query.set("kwd", keyword);
    await page.goto(`${IKYU_TOP_URL}search/?${query.toString()}`, { waitUntil: "domcontentloaded" });
  }

  private async fillFirstVisible(
    page: Page,
    attempts: Array<{ selector: string; value?: string | null }>
  ): Promise<void> {
    for (const attempt of attempts) {
      if (!attempt.value) continue;
      const locator = page.locator(attempt.selector).first();
      if (await locator.isVisible().catch(() => false)) {
        await locator.fill(attempt.value).catch(() => undefined);
        return;
      }
    }
  }

  private async extractCandidates(page: Page): Promise<Candidate[]> {
    const candidates = await page.evaluate(() => {
      const normalize = (value?: string | null) => (value ?? "").replace(/\s+/g, " ").trim();
      const restaurantHrefPattern = /(?:^\/(?:restaurant\/)?\d+\/?|restaurant\.ikyu\.com\/(?:restaurant\/)?\d+)/;
      const cardSelectors = [
        '[data-testid*="restaurant"]',
        '[class*="restaurant"]',
        '[class*="Restaurant"]',
        '[class*="plan"]',
        '[class*="Plan"]',
        '[class*="shop"]',
        '[class*="Shop"]',
        '[class*="store"]',
        '[class*="Store"]',
        "article",
        "li"
      ];
      const cards = Array.from(document.querySelectorAll(cardSelectors.join(","))).slice(0, 80);
      const seen = new Set<string>();

      const fromCard = (card: Element) => {
        const link = Array.from(card.querySelectorAll("a")).find((anchor) => {
          const href = anchor.getAttribute("href") ?? "";
          return restaurantHrefPattern.test(href);
        });
        const href = link?.getAttribute("href");
        const url = href ? new URL(href, location.origin).toString() : "";
        const heading =
          card.querySelector("h1,h2,h3,[class*=name],[class*=Name],[class*=title],[class*=Title]")?.textContent ??
          link?.textContent ??
          "";
        const text = normalize(card.textContent);
        const price = text.match(/(?:￥|¥)[\d,]+(?:\s*[〜~-]\s*(?:￥|¥)?[\d,]+)?|[\d,]+円(?:\s*[〜~-]\s*[\d,]+円)?/)?.[0];
        const availability =
          text.match(/空席あり|予約可|残り\d+席|リクエスト予約|即予約|満席|空席なし/)?.[0] ?? "不明";
        const genre = text.match(/(和食|鮨|寿司|イタリアン|フレンチ|中国料理|中華|焼肉|鉄板焼|懐石|割烹|ビュッフェ|洋食|ワインバー|バー|スペイン料理|ステーキ)/)?.[0];
        const area = text.match(/(豊田|豊田市|名古屋|栄|伏見|愛知|銀座|新宿|渋谷|六本木|恵比寿|丸の内|東京|表参道|青山|品川|横浜|京都|大阪|神戸)/)?.[0];
        return {
          name: normalize(heading),
          url,
          availability,
          price,
          genre,
          area,
          extractionNote: text.slice(0, 300)
        };
      };

      const candidatesFromCards = cards
        .map(fromCard)
        .filter((candidate) => {
          if (!candidate.name || !candidate.url || seen.has(candidate.url)) return false;
          seen.add(candidate.url);
          return true;
        });

      const candidatesFromLinks = Array.from(document.querySelectorAll("a"))
        .filter((anchor) => restaurantHrefPattern.test(anchor.getAttribute("href") ?? ""))
        .map((anchor) => fromCard(anchor.closest("article,li,section,div") ?? anchor))
        .filter((candidate) => {
          if (!candidate.name || !candidate.url || seen.has(candidate.url)) return false;
          seen.add(candidate.url);
          return true;
        });

      return [...candidatesFromCards, ...candidatesFromLinks]
        .map((card) => {
          const name = card.name.replace(/^一休\.comレストラン\s*/, "");
          return { ...card, name };
        });
    });

    return candidates;
  }

  private async openKeywordSearch(page: Page, intent: ReservationIntent): Promise<void> {
    const query = new URLSearchParams();
    const keyword = this.keywordForIntent(intent);
    if (keyword) query.set("kwd", keyword);
    await page.goto(`${IKYU_TOP_URL}search/?${query.toString()}`, { waitUntil: "domcontentloaded" });
  }

  private keywordForIntent(intent: ReservationIntent): string {
    return [intent.area, intent.genre, ...(intent.preferences ?? [])].filter(Boolean).join(" ");
  }

  private async trySelectReservationInputs(page: Page, intent: ReservationIntent): Promise<void> {
    await this.clickFirstVisible(page, [/予約する/, /このプランを予約/, /空席確認/, /日時を選択/]);
    await page.waitForTimeout(1000);

    if (intent.date) {
      await this.fillFirstVisible(page, [
        { selector: 'input[name*="date"]', value: intent.date },
        { selector: 'input[placeholder*="日付"]', value: intent.date }
      ]);
    }
    if (intent.time) {
      await this.fillFirstVisible(page, [
        { selector: 'input[name*="time"]', value: intent.time },
        { selector: 'input[placeholder*="時間"]', value: intent.time }
      ]);
    }
    if (intent.partySize) {
      await this.fillFirstVisible(page, [
        { selector: 'input[name*="person"]', value: String(intent.partySize) },
        { selector: 'input[placeholder*="人数"]', value: String(intent.partySize) }
      ]);
    }
  }

  private async clickFirstVisible(page: Page, names: RegExp[]): Promise<void> {
    for (const name of names) {
      const element = page.getByRole("button", { name }).or(page.getByRole("link", { name })).first();
      if (await element.isVisible().catch(() => false)) {
        await Promise.all([
          page.waitForLoadState("domcontentloaded").catch(() => undefined),
          element.click()
        ]);
        return;
      }
    }
  }

  private async detectUnsafeStep(page: Page): Promise<string | undefined> {
    const bodyText = await page.locator("body").innerText({ timeout: 5000 }).catch(() => "");
    return detectUnsafeBookingText(bodyText);
  }

  private async saveFailureArtifact(page: Page, jobId: string, reason: string): Promise<unknown> {
    await mkdir(ARTIFACT_DIR, { recursive: true });
    const prefix = join(ARTIFACT_DIR, `${jobId}-${Date.now()}-${reason}`);
    const screenshotPath = `${prefix}.png`;
    const htmlPath = `${prefix}.html`;
    await page.screenshot({ path: screenshotPath, fullPage: true }).catch(() => undefined);
    await writeFile(htmlPath, await page.content()).catch(() => undefined);
    return {
      reason,
      url: page.url(),
      screenshotPath,
      htmlPath
    };
  }
}
