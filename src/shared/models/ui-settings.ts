import type { AppLanguage, AppTheme } from '../types';

// UI 設定 (ui テーブル相当)
// テーマと表示言語の選択を永続化する
export type UiSettings = {
    // テーマ (light / dark / system)
    theme: AppTheme;
    // 表示言語。null の場合は OS のロケールに従う
    language: AppLanguage | null;
};

export const DEFAULT_UI_SETTINGS: UiSettings = {
    theme: 'system',
    language: null,
};
