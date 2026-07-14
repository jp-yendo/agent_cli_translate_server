import { getLanguageName } from '../../shared/languages';
import {
    cleanChatResponse,
    type ChatMessages,
    type TranslationAttempt,
    type TranslationRequest,
} from './prompt-profiles/base';
import { modelPromptProfiles } from './prompt-profiles';

// AI 翻訳用のプロンプト構築・応答解析
//
// プロンプト生成 (buildTranslationAttempts) と結果解析 (各試行の validate) は
// 全経路 (Agent CLI / API) で共通。経路ごとに異なるのは「プロンプトをどう送って
// 応答を得るか」(dispatch) のみで、runTranslationAttempts がその差を吸収する。
//
// 既定 (一般モデル) の対応は本ファイルが持つ。既定から外れるモデル固有の対応は
// prompt-profiles/ ディレクトリにプロファイルとして 1 ファイルずつ置き、
// prompt-profiles/index.ts のレジストリ (modelPromptProfiles) へ登録する。

// 共通の型・応答解析は base に集約し、既定処理と各プロファイルの双方から参照する
export { cleanChatResponse } from './prompt-profiles/base';
export type { ChatMessages, TranslationAttempt, TranslationRequest } from './prompt-profiles/base';

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

// 一般モデル向けの既定試行 (1 回。system/user 形式で原文をそのまま翻訳させる)
function buildDefaultAttempts(request: TranslationRequest): TranslationAttempt[] {
    return [
        {
            messages: buildDefaultMessages(request.text, request.srcLang, request.dstLang, request.appSummary),
            validate: raw => {
                const t = cleanChatResponse(raw);
                return { ok: t !== '', text: t };
            },
        },
    ];
}

// モデルに応じた翻訳試行の組み立て
// 固有プロファイル (prompt-profiles) が一致すればそれを、無ければ既定処理を用いる
export function buildTranslationAttempts(request: TranslationRequest, model: string): TranslationAttempt[] {
    const profile = modelPromptProfiles.find(p => p.matches(model));
    return profile ? profile.build(request) : buildDefaultAttempts(request);
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
    const attempts = buildTranslationAttempts(request, model);
    for (const attempt of attempts) {
        const raw = await dispatch(attempt.messages);
        const result = attempt.validate(raw);
        if (result.ok) {
            return result.text;
        }
    }
    throw new Error('No usable translation was produced');
}
