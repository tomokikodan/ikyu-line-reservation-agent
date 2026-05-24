export function detectUnsafeBookingText(bodyText: string): string | undefined {
  const checks: Array<[RegExp, string]> = [
    [/ログイン|会員登録|メールアドレス|パスワード/, "ログインまたは会員情報入力が必要な画面で停止しました。"],
    [/氏名|お名前|電話番号|連絡先|住所/, "個人情報入力が必要な画面で停止しました。"],
    [/クレジットカード|決済|支払い|カード番号/, "決済情報入力が必要な画面で停止しました。"],
    [/キャンセル料|キャンセルポリシー.*同意|同意して予約/, "キャンセル料や規約同意が必要な画面で停止しました。"],
    [/予約を確定|予約確定|確定する/, "予約確定ボタンのある画面で停止しました。"]
  ];
  return checks.find(([pattern]) => pattern.test(bodyText))?.[1];
}
