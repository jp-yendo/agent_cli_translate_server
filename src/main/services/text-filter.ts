// 翻訳前のテキストフィルタリング

// FPS表示など、定期的に変化する動的な値かどうかを判定する
// 動的な値は翻訳せず 400 を返し、XUnity.AutoTranslator 側にキャッシュさせない
export function isDynamicValue(text: string): boolean {
    const fpsPattern =
        /(?:FPS|F\.P\.S\.?|framerate|frame\s*rate)\s*[:：]?\s*\d+(?:\.\d+)?|\d+(?:\.\d+)?\s*(?:FPS|F\.P\.S\.?|framerate|frame\s*rate)/i;
    return fpsPattern.test(text);
}

// 翻訳をスキップすべきテキスト (数字・空白・記号のみで文字を含まない) かどうかを判定する
// スキップ対象は原文をそのまま 200 で返す
export function shouldSkipTranslation(text: string): boolean {
    if (!text || !text.trim()) {
        return true;
    }
    // Unicode の Letter カテゴリを1文字も含まなければ翻訳不要
    return !/\p{L}/u.test(text);
}
