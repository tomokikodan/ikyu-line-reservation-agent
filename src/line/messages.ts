import type { Candidate, MissingField, RankedCandidate, ReservationIntent, SearchProgress } from "../types.js";

const fieldQuestions: Record<MissingField, string> = {
  date: "ご希望の日付を教えてください。例: 6月15日、来週金曜",
  time: "ご希望の開始時間を教えてください。例: 19:00",
  partySize: "ご利用人数を教えてください。例: 2名",
  area: "ご希望エリアを教えてください。例: 銀座、渋谷、新宿"
};

export function questionForMissingField(field: MissingField): string {
  return fieldQuestions[field];
}

export function formatSearchStarted(intent: ReservationIntent): string {
  const date = intent.date ?? "日付未指定";
  const time = intent.time ?? "時間未指定";
  const people = intent.partySize ? `${intent.partySize}名` : "人数未指定";
  const area = intent.area ?? "エリア未指定";
  return `条件を確認しました。\n${date} ${time} / ${people} / ${area}\n一休レストランで空席候補を検索します。進捗もこのトークに表示します。`;
}

export function formatSearchProgress(progress: SearchProgress): string {
  return `処理中: ${progress.message}`;
}

export function formatCandidates(candidates: RankedCandidate[] | Candidate[]): string {
  if (candidates.length === 0) {
    return "条件に合う予約可能候補を見つけられませんでした。条件を少し広げて再検索できます。";
  }
  const lines = candidates.map((candidate, index) => {
    const rank = candidate.rank ?? index + 1;
    const bits = [
      `${rank}. ${candidate.name}`,
      candidate.genre ? `ジャンル: ${candidate.genre}` : undefined,
      candidate.area ? `エリア: ${candidate.area}` : undefined,
      candidate.price ? `価格: ${candidate.price}` : undefined,
      `空席: ${candidate.availability}`,
      candidate.evaluationReason ? `理由: ${candidate.evaluationReason}` : undefined,
      candidate.url
    ].filter(Boolean);
    return bits.join("\n");
  });
  return `候補を5件に絞りました。\n予約に進む場合は「1番を予約したい」のように番号で教えてください。\n\n${lines.join("\n\n")}`;
}

export function formatBookingHandoff(candidateName: string, handoffUrl?: string, stopReason?: string): string {
  const urlLine = handoffUrl ? `\n続きはこちらからお願いします:\n${handoffUrl}` : "";
  return `${candidateName} の予約画面を進めました。\n${stopReason ?? "予約確定や個人情報入力が必要な画面の直前で停止しました。"}${urlLine}\n\n予約確定、決済、キャンセル料同意、ログイン情報入力は自動実行していません。`;
}
