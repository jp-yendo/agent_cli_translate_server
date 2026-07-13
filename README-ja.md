# Agent CLI Translate Server

[English README is here](README.md)

## 1. システム概要

Agent CLI Translate Server は、[XUnity.AutoTranslator](https://github.com/bbepis/XUnity.AutoTranslator) の CustomTranslate 用 AI 翻訳サーバーの GUI アプリケーションです。

各 AI プロバイダーの API キーを直接利用するのではなく、ローカルにインストール済みの Agent CLI (コーディングエージェントの CLI) をプロセスとして起動して翻訳を行います。すでに Agent CLI へログインしていれば、追加の API キー設定なしで利用できます。

通信の仕様は XUnity.AutoTranslator の CustomTranslate エンドポイント仕様 (`GET /translate?from=...&to=...&text=...` に対しプレーンテキストで翻訳結果を返す) に合わせており、XUnity.AutoTranslator の CustomTranslate としてそのまま利用できます。

### 主な機能

- CustomTranslate 仕様に準拠した HTTP API (`/translate`, `/health`)
- 対応 Agent CLI の自動検出と、選択したエージェントでの翻訳サーバー起動 (同時に起動できるのは1つ)
- エージェントプール: 最低1つの再利用可能なエージェントプロセスの起動成功後に待ち受けを開始し、設定した同時起動数まで並列翻訳。超過分は待ち行列で処理し、設定稼働時間または利用回数の上限でプロセスを交換
- 翻訳ヒント管理: 翻訳対象アプリの概要 (サマリ) を登録し、内容に合った翻訳を実現
- 動作状況ログ (直近200件、自動スクロール対応)
- 改行・空白・タグを保持した翻訳、動的な値 (FPS 表示等) や翻訳不要テキストのフィルタリング

### 対応 Agent CLI

| Agent CLI | コマンド | 提供元パッケージ | 同時起動数デフォルト |
| --- | --- | --- | --- |
| Claude Code | `claude` | `@anthropic-ai/claude-code` | 5 |
| Codex CLI | `codex` | `@openai/codex` | 5 |
| Grok CLI | `grok` | `@xai-official/grok` | 5 |
| opencode | `opencode` | `opencode-ai` | 1 |
| OpenCode (Ollama) | `ollama launch opencode --model <model>` | Ollama + opencode | 1 |

各 Agent CLI は事前にインストールし、それぞれの手順でログイン (認証) を済ませておいてください。
OpenCode (Ollama) では Ollama と OpenCode の両方をインストールし、開始前に Agent 個別設定へ Ollama モデル名を保存してください。

### XUnity.AutoTranslator での設定

`AutoTranslatorConfig.ini` に以下を設定します:

```ini
[Service]
Endpoint=CustomTranslate

[Custom]
Url=http://127.0.0.1:4660/translate
```

待ち受けアドレス・ポートを変更した場合は `Url` を合わせて変更してください。

### API サンプル

翻訳リクエスト (CustomTranslate 仕様):

```http
GET http://127.0.0.1:4660/translate?from=ja&to=en&text=こんにちは
```

レスポンス (200, text/plain):

```text
Hello
```

ヘルスチェック:

```http
GET http://127.0.0.1:4660/health
```

レスポンス (200, text/plain):

```text
ok
```

curl での動作確認例:

```bash
curl "http://127.0.0.1:4660/translate?from=en&to=ja&text=Hello"
```

### 使い方

1. アプリを起動し、「共通設定」タブで待ち受けアドレス (デフォルト 127.0.0.1)・ポート (デフォルト 4660)・フォールバック言語・エージェントプロセス稼働時間 (デフォルト 300秒) を確認・保存します。
2. 必要に応じて「翻訳ヒント」タブで翻訳対象アプリの概要を登録します。
3. 「サーバー」タブで利用する Agent CLI のアコーディオンを開き、同時起動数・プロセス最大利用回数・翻訳ヒントを設定して保存します。
4. エージェント名の行にある「開始」ボタンで翻訳サーバーを起動します (起動中は他のエージェントは開始できません)。
5. 「ログ」タブで翻訳依頼・翻訳結果などの動作状況を確認できます。

### 設定ファイル

設定は `~/.agent_cli_translate_server/settings.json` に保存されます。

## 2. 対応OS

- Windows 10/11
- macOS 10.15+
- Linux (Debian系/RHEL系)

注記: 本プロジェクトは Windows ではコード署名を行っていません。SmartScreen が警告を表示する場合は「詳細情報」→「実行」を選択してください。

## 3. 開発者向けリファレンス

### 必要要件

- Node.js 22.x以上
- yarn 4
- Git

### インストール

```bash
# リポジトリのクローン
git clone <repository-url>
cd <repository-name>

# 依存関係のインストール
yarn install

# 開発起動
yarn dev
```

開発時のDevTools:

- DevTools はデタッチ表示で自動的に開きます
- F12 または Ctrl+Shift+I（macOSは Cmd+Option+I）でトグル可能

### ビルド/配布

- Windows: `yarn dist:win`
- macOS: `yarn dist:mac`
- Linux: `yarn dist:linux`

開発時は BrowserRouter で `<http://localhost:3001>` を、配布ビルドでは HashRouter で `dist/renderer/index.html` を読み込みます。

### GitHub への直接リリース (自動アップデート用)

`electron-builder.yml` の `publish:` に設定した GitHub リポジトリに、ビルド成果物と `latest*.yml` (自動アップデート用メタデータ) を直接アップロードするコマンドです。`releaseType: draft` 設定のため、各コマンドは GitHub 上の **同一バージョンのドラフトリリースに集約** されます。全プラットフォーム揃ってから GitHub UI で「Publish release」を押すとユーザーへ配信されます。

- Windows: `yarn release:win`
- macOS: `yarn release:mac`
- Linux: `yarn release:linux`

実行前に GitHub Personal Access Token (`public_repo` スコープ) を環境変数 `GH_TOKEN` に設定してください。

```bash
export GH_TOKEN="ghp_xxxxxxxxxxxxxxxxxxxx"
```

複数台で各プラットフォームをビルドする場合は、`package.json` の `version` を全マシンで一致させた上で、各マシンで該当する `release:*` を順に実行してください。

### macOS 事前準備: 署名・公証用の環境変数

macOS 向けに署名・公証付きビルドを行う場合は、`yarn dist:mac` の実行前に以下の環境変数を設定してください。

```bash
export APPLE_ID="your-apple-id@example.com"
export APPLE_APP_SPECIFIC_PASSWORD="xxxx-xxxx-xxxx-xxxx"
export APPLE_TEAM_ID="XXXXXXXXXX"
```

### Windows 事前準備: 開発者モード

Windows で署名なしのローカルビルド/配布物を実行・テストする場合は、OSの開発者モードを有効にしてください。

1. 設定 → プライバシーとセキュリティ → 開発者向け
2. 「開発者モード」をオンにする
3. OSを再起動

### プロジェクト構造 (抜粋)

```text
src/
├── main/                  # Electron メイン: IPC/各種マネージャ
│   ├── index.ts           # 起動・ウィンドウ生成・サービス初期化
│   ├── ipc/               # IPCハンドラ
│   ├── services/          # 翻訳サーバー・エージェントプール等の各種サービス
│   └── utils/             # 各種ユーティリティ
├── preload/               # renderer へ安全にAPIをブリッジ
├── renderer/              # React + MUI UI
├── shared/                # 型定義・定数(Default設定/保存パス)・データモデル
└── public/                # アイコン等
```

詳細は [Documents/システム仕様.md](Documents/システム仕様.md) と [Documents/テーブル定義.md](Documents/テーブル定義.md) を参照してください。

### 使用技術

- **Electron**
- **React (MUI v9)**
- **TypeScript**
- **Zustand**
- **i18next**
- **Vite**

### Windows用アイコンの作成

```exec
magick public/icon.png -define icon:auto-resize=256,128,96,64,48,32,24,16 public/icon.ico
```

## ライセンス

MIT License
