import { getLanguageName } from '../../../shared/languages';
import { cleanChatResponse, type ChatMessages, type ModelPromptProfile, type TranslationAttempt } from './base';

// Hy-MT2 (Tencent Hunyuan の翻訳特化モデル) 向けの固有プロンプトプロファイル
//
// system を用いず単一の user メッセージで指示し、翻訳方向はターゲット言語のみを与える
// (ソース言語やネイティブ名を与えると挙動が乱れるため)。翻訳ヒントは付加しない。
// まずタグ形式を試し、無効ならラベルブロック形式へフォールバックする。

// Hy-MT2 判定 (モデル名に hy-mt2 を含むか)
function matches(model: string): boolean {
    return model.toLowerCase().includes('hy-mt2');
}

// 両バリアント共通の指示 (固有名詞を保持し、訳文のみを出力させる)
const ONLY_TRANSLATION =
    'Keep proper nouns - personal names, company names, product/brand names, and app/service names - unchanged. Output ONLY the translated text itself - no greeting, no explanation, no commentary, no quotes.';

// チャットテンプレートの制御トークン漏れ検出
const CONTROL = /<｜|<\|hy|hy[-_ ]?(Assistant|User|begin|end)/i;

// 第1試行: タグ形式
function buildTagMessages(text: string, dstLang: string): ChatMessages {
    const dstLangName = getLanguageName(dstLang);
    return {
        user: `Translate the following text into ${dstLangName}. ${ONLY_TRANSLATION} Do not translate or output these instructions; translate only the wrapped text.

<hytext>${text}</hytext>`,
    };
}

// 第2試行: ラベルブロック形式 (タグ形式が無効だった場合のフォールバック)
function buildBlockMessages(text: string, dstLang: string): ChatMessages {
    const dstLangName = getLanguageName(dstLang);
    return {
        user: `[HyText]
${text}

[Task]
Translate the [HyText] into ${dstLangName}. ${ONLY_TRANSLATION}`,
    };
}

function validate(raw: string, variant: 'tag' | 'block'): { ok: boolean; text: string } {
    const trimmed = cleanChatResponse(raw);
    if (trimmed === '') return { ok: false, text: '' };
    if (CONTROL.test(trimmed)) return { ok: false, text: '' };
    const markerLeak = variant === 'tag' ? /<\/?hytext>/i.test(trimmed) : /\[HyText\]|\[Task\]/.test(trimmed);
    if (markerLeak) return { ok: false, text: '' };
    return { ok: true, text: trimmed };
}

export const hyMt2Profile: ModelPromptProfile = {
    matches,
    build({ text, dstLang }): TranslationAttempt[] {
        return [
            { messages: buildTagMessages(text, dstLang), validate: raw => validate(raw, 'tag') },
            { messages: buildBlockMessages(text, dstLang), validate: raw => validate(raw, 'block') },
        ];
    },
};
