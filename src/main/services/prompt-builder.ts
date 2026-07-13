import { getLanguageName } from '../../shared/languages';

// AI翻訳用のプロンプト構築

export function buildSystemPrompt(appSummary?: string): string {
    let basePrompt = `You are a professional translator for games and applications.

CRITICAL RULES:
- Output ONLY the <translate> tag with translation
- NO explanations or extra text
- Preserve ALL whitespace exactly (leading/trailing spaces, newlines, indentation)
- Preserve ALL tags and markup structure (translate only the content within tags)
- For single words or short phrases, aim for balanced character width using concise wording (multibyte chars = width 2, single-byte chars = width 1)
- Maintain original line breaks and formatting
- Keep terms already established in the target language region (e.g., in Japan: ATK, HP, MP, ID)`;

    if (appSummary) {
        basePrompt += `\n\n<app_context>\nBackground information about the application (NOT for translation - use this to understand the domain and terminology):\n${appSummary}\n</app_context>`;
    }

    return basePrompt;
}

export function buildTranslationRequest(text: string, srcLang: string, dstLang: string): string {
    const srcLangName = getLanguageName(srcLang);
    const dstLangName = getLanguageName(dstLang);

    return `Translate from ${srcLangName} to ${dstLangName}:

<request_text>${text}</request_text>

Output format:
<translate>your translation here</translate>

Rules:
- Output ONLY the <translate> tag with translation
- NO explanations or extra text
- Keep exact same whitespace/newlines
- Preserve all tags and markup (translate content only)
- For short text, aim for balanced character width using concise wording (multibyte = 2, single-byte = 1)
- Keep established terms unchanged (e.g., in Japan: ATK, HP, MP)`;
}

// Agent CLI へ渡す単一プロンプト (システムプロンプト + 翻訳リクエスト)
export function buildFullPrompt(text: string, srcLang: string, dstLang: string, appSummary?: string): string {
    return `${buildSystemPrompt(appSummary)}\n\n${buildTranslationRequest(text, srcLang, dstLang)}`;
}

// ANSIエスケープシーケンスを除去する (CLI出力の装飾対策)
function stripAnsi(text: string): string {
    // eslint-disable-next-line no-control-regex -- CLI出力からANSI制御コードを取り除くために制御文字の照合が必要
    return text.replace(/\u001b\[[0-9;]*[A-Za-z]/g, '');
}

// Agent CLI の応答から <translate> タグの中身を抽出する
// CLI がプロンプトをエコーする場合に備え、最後に出現したタグを採用する
export function extractTranslation(response: string): string {
    const cleaned = stripAnsi(response);
    const matches = [...cleaned.matchAll(/<translate>([\s\S]*?)<\/translate>/g)];
    // プロンプト内の出力例 (your translation here) を除外する
    const candidates = matches.map(m => m[1]).filter(value => value !== 'your translation here');
    if (candidates.length === 0) {
        throw new Error(`Failed to extract translation. Response: ${cleaned.slice(0, 200)}`);
    }
    return candidates[candidates.length - 1];
}
