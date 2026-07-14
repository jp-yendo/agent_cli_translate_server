// モデル別プロンプトプロファイルの共通基盤
//
// 既定処理 (prompt-builder.ts) と各モデル固有プロファイル (prompt-profiles/*.ts) の
// 双方がここへ依存する。循環参照を避けるため、共通の型・応答解析だけをここに置き、
// プロンプトの組み立てや試行の統括は依存先には持たせない。

// 1 件の翻訳依頼 (プロンプトの組み立て方は経路・モデルごとに異なるため素の情報を渡す)
export interface TranslationRequest {
    text: string;
    srcLang: string;
    dstLang: string;
    appSummary?: string;
}

// チャット形式のメッセージ (system / user のロール分離)
// system/user を持たない Agent CLI では flattenChatMessages で 1 本に結合する
export type ChatMessages = { system?: string; user: string };

// 1 回の翻訳試行 (プロンプトと、その応答を訳文へ整形・検証する関数の組)
// 複数の試行を先頭から順に試し、最初に妥当な出力を採用する
export type TranslationAttempt = {
    messages: ChatMessages;
    validate: (raw: string) => { ok: boolean; text: string };
};

// モデル固有プロンプトプロファイルの契約
// 既定 (一般モデル) から外れるモデルは、この形でプロファイルを 1 つ実装し
// prompt-profiles/index.ts のレジストリへ登録する。
export interface ModelPromptProfile {
    // モデル名がこのプロファイルの対象かを判定する
    matches(model: string): boolean;
    // このモデル向けの翻訳試行 (1 件以上) を先頭優先で組み立てる
    build(request: TranslationRequest): TranslationAttempt[];
}

// ANSIエスケープシーケンスを除去する (CLI出力の装飾対策)
function stripAnsi(text: string): string {
    // eslint-disable-next-line no-control-regex -- CLI出力からANSI制御コードを取り除くために制御文字の照合が必要
    return text.replace(/\u001b\[[0-9;]*[A-Za-z]/g, '');
}

// チャット API の応答から訳文を取り出す
// 推論モデルの <think> ブロックと、全体を囲むコードフェンスを除去して前後の空白を整える
export function cleanChatResponse(response: string): string {
    let text = stripAnsi(response).replace(/<think>[\s\S]*?<\/think>/gi, '');
    const fenced = text.trim().match(/^```[^\n]*\n([\s\S]*?)\n?```$/);
    if (fenced) text = fenced[1];
    return text.trim();
}
