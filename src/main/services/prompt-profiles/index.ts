import type { ModelPromptProfile } from './base';
import { hyMt2Profile } from './hy-mt2';

// 既定 (一般モデル) から外れるモデルの固有プロンプトプロファイル一覧
//
// 新しい固有対応を追加するときは、prompt-profiles/ にプロファイル 1 ファイルを作成し
// (base.ts の ModelPromptProfile を実装)、ここへ登録する。buildTranslationAttempts は
// 先頭から matches() を評価し、最初に一致したプロファイルを採用する。
export const modelPromptProfiles: ModelPromptProfile[] = [hyMt2Profile];

export type { ModelPromptProfile } from './base';
