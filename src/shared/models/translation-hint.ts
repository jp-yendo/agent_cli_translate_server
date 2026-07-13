// 翻訳ヒント (hints テーブル相当)
// エージェントへ翻訳依頼する際に添付するアプリ概要 (サマリ) を管理する
export type TranslationHint = {
    // 一意なID (UUID)
    id: string;
    // 表示名
    name: string;
    // アプリ概要 (プロンプトの app_context として渡される)
    summary: string;
};
