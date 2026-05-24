# 一休レストラン LINE予約エージェント MVP

LINEで自然言語のレストラン予約要望を受け取り、OpenAI APIで条件を構造化し、一休レストランをPlaywrightで検索して候補を5件返信するMVPです。

## 構成

- Node.js / TypeScript / Express
- LINE Messaging API webhook
- OpenAI Responses API Structured Outputs
- Playwright Chromium
- Postgres
- Render Docker Web Service

## セットアップ

```bash
npm install
cp .env.example .env
npm run migrate
npm run dev
```

LINE Developers ConsoleのWebhook URLには次を設定します。

```text
https://<your-render-service>.onrender.com/webhooks/line
```

## 必須環境変数

- `OPENAI_API_KEY`
- `OPENAI_MODEL` default: `gpt-5.4-mini`
- `LINE_CHANNEL_SECRET`
- `LINE_CHANNEL_ACCESS_TOKEN`
- `DATABASE_URL`
- `ADMIN_TOKEN`
- `APP_BASE_URL`
- `PLAYWRIGHT_HEADLESS`
- `SEARCH_TIMEOUT_MS`
- `MAX_SEARCH_CONCURRENCY`

## Renderデプロイ

1. GitHubに新規repo `ikyu-line-reservation-agent` を作成します。
2. このプロジェクトをpushします。
3. RenderでBlueprintまたはDocker Web Serviceとして作成します。
4. `render.yaml` のPostgresが作成され、`DATABASE_URL` がWeb Serviceへ渡されます。
5. RenderのEnvironmentでLINE/OpenAI/Adminトークンを設定します。

DockerはPlaywright公式イメージを使い、起動時に `npm run migrate && npm run start` を実行します。

## 安全境界

以下は自動実行しません。

- 予約確定ボタン押下
- 決済情報入力
- キャンセル料や規約への同意
- ログイン情報入力
- 氏名、電話番号などの個人情報入力

該当画面に到達した場合は停止し、LINEでURLと残り操作を案内します。

## LINEで表示する進捗

一休検索はブラウザ起動やページ読み込みで時間がかかることがあります。検索ジョブ中はLINEに次のような進捗をpush通知します。

- 検索用ブラウザを起動中
- 一休レストランを開いている
- 希望条件を検索画面に入力中
- 検索結果から候補情報を読み取り中
- OpenAIで5件へ絞り込み中
- LINE返信を作成中

## 管理確認

検索ジョブは次で確認できます。

```bash
curl -H "Authorization: Bearer $ADMIN_TOKEN" \
  https://<your-render-service>.onrender.com/admin/jobs/<job-id>
```

## テスト

```bash
npm test
```

一休のライブ検索はサイト構造やアクセス制限の影響を受けるため、通常テストでは実行しません。ライブ検証を追加する場合は `RUN_LIVE_IKYU=true` を使います。
