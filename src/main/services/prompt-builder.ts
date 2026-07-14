import { getLanguageName } from '../../shared/languages';

// AI 翻訳用のプロンプト構築・応答解析
//
// プロンプト生成 (buildTranslationAttempts) と結果解析 (各試行の validate) は
// 全経路 (Agent CLI / API) で共通。経路ごとに異なるのは「プロンプトをどう送って
// 応答を得るか」(dispatch) のみで、runTranslationAttempts がその差を吸収する。

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

// Hy-MT2 (Tencent Hunyuan の翻訳特化モデル) 判定
export function isHyMt2Model(model: string): boolean {
    return model.toLowerCase().includes('hy-mt2');
}

// 一般モデル向けのメッセージ
// system へ翻訳規則を、user へ原文をそのまま渡す (指示は翻訳対象ではない)
function buildDefaultMessages(text: string, srcLang: string, dstLang: string, appSummary?: string): ChatMessages {
    const srcLangName = getLanguageName(srcLang);
    const dstLangName = getLanguageName(dstLang);

    let system = `You are a precise translation engine. Translate the text provided by the user from ${srcLangName} to ${dstLangName}.
- Respond ONLY with the translation, with no explanations, comments, or extra text.
- Keep all tags, attributes, whitespace, and line breaks exactly as in the original.
- Do not translate programming code, API calls, placeholders, or other technical snippets; copy them exactly.
- Keep terms already established in the target language region unchanged (e.g., in Japan: ATK, HP, MP, ID).`;

    if (appSummary) {
        system += `\n\n<app_context>\nBackground information about the application (NOT for translation - use it only to choose appropriate terminology):\n${appSummary}\n</app_context>`;
    }

    return { system, user: text };
}

// Hy-MT2 向けの共通指示 (固有名詞を保持し、訳文のみを出力させる)
const HY_MT2_ONLY_TRANSLATION =
    'Keep proper nouns - personal names, company names, product/brand names, and app/service names - unchanged. Output ONLY the translated text itself - no greeting, no explanation, no commentary, no quotes.';
// チャットテンプレートの制御トークン漏れ検出
const HY_MT2_CONTROL = /<｜|<\|hy|hy[-_ ]?(Assistant|User|begin|end)/i;

// Hy-MT2 は翻訳方向としてターゲット言語のみを与える (ソース言語やネイティブ名で挙動が乱れるため)
function buildHyMt2TagMessages(text: string, dstLang: string): ChatMessages {
    const dstLangName = getLanguageName(dstLang);
    return {
        user: `Translate the following text into ${dstLangName}. ${HY_MT2_ONLY_TRANSLATION} Do not translate or output these instructions; translate only the wrapped text.

<hytext>${text}</hytext>`,
    };
}

function buildHyMt2BlockMessages(text: string, dstLang: string): ChatMessages {
    const dstLangName = getLanguageName(dstLang);
    return {
        user: `[HyText]
${text}

[Task]
Translate the [HyText] into ${dstLangName}. ${HY_MT2_ONLY_TRANSLATION}`,
    };
}

function validateHyMt2(raw: string, variant: 'tag' | 'block'): { ok: boolean; text: string } {
    const trimmed = cleanChatResponse(raw);
    if (trimmed === '') return { ok: false, text: '' };
    if (HY_MT2_CONTROL.test(trimmed)) return { ok: false, text: '' };
    const markerLeak = variant === 'tag' ? /<\/?hytext>/i.test(trimmed) : /\[HyText\]|\[Task\]/.test(trimmed);
    if (markerLeak) return { ok: false, text: '' };
    return { ok: true, text: trimmed };
}

// モデルに応じた翻訳試行の組み立て
// Hy-MT2 はタグ形式 → ラベルブロック形式の 2 バリアントを順に試す
export function buildTranslationAttempts(
    text: string,
    srcLang: string,
    dstLang: string,
    appSummary: string | undefined,
    model: string
): TranslationAttempt[] {
    if (isHyMt2Model(model)) {
        return [
            { messages: buildHyMt2TagMessages(text, dstLang), validate: raw => validateHyMt2(raw, 'tag') },
            { messages: buildHyMt2BlockMessages(text, dstLang), validate: raw => validateHyMt2(raw, 'block') },
        ];
    }
    return [
        {
            messages: buildDefaultMessages(text, srcLang, dstLang, appSummary),
            validate: raw => {
                const t = cleanChatResponse(raw);
                return { ok: t !== '', text: t };
            },
        },
    ];
}

// ANSIエスケープシーケンスを除去する (CLI出力の装飾対策)
function stripAnsi(text: string): string {
    // eslint-disable-next-line no-control-regex -- CLI出力からANSI制御コードを取り除くために制御文字の照合が必要
    return text.replace(/\u001b\[[0-9;]*[A-Za-z]/g, '');
}

// system と user を 1 本のプロンプト文字列へ結合する (ロールを持たない Agent CLI 用)
export function flattenChatMessages(messages: ChatMessages): string {
    return messages.system ? `${messages.system}\n\n${messages.user}` : messages.user;
}

// 翻訳試行を先頭から順に dispatch し、最初に妥当な出力 (訳文) を採用する
// dispatch は経路ごとのパイプライン (Agent CLI のプロセス入出力 / API 呼び出し) を担う
export async function runTranslationAttempts(
    request: TranslationRequest,
    model: string,
    dispatch: (messages: ChatMessages) => Promise<string>
): Promise<string> {
    const attempts = buildTranslationAttempts(request.text, request.srcLang, request.dstLang, request.appSummary, model);
    for (const attempt of attempts) {
        const raw = await dispatch(attempt.messages);
        const result = attempt.validate(raw);
        if (result.ok) {
            return result.text;
        }
    }
    throw new Error('No usable translation was produced');
}

// チャット API の応答から訳文を取り出す
// 推論モデルの <think> ブロックと、全体を囲むコードフェンスを除去して前後の空白を整える
export function cleanChatResponse(response: string): string {
    let text = stripAnsi(response).replace(/<think>[\s\S]*?<\/think>/gi, '');
    const fenced = text.trim().match(/^```[^\n]*\n([\s\S]*?)\n?```$/);
    if (fenced) text = fenced[1];
    return text.trim();
}
