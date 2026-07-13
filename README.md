# Agent CLI Translate Server

[日本語のREADMEはこちら](README-ja.md)

## 1. Overview

Agent CLI Translate Server is a GUI application that provides an AI translation server for the CustomTranslate endpoint of [XUnity.AutoTranslator](https://github.com/bbepis/XUnity.AutoTranslator).

Instead of calling AI provider APIs with API keys directly, it launches locally installed agent CLIs (coding-agent command line tools) as processes to perform translations. If you are already logged in to an agent CLI, no additional API key setup is required.

The communication protocol follows the CustomTranslate endpoint specification of XUnity.AutoTranslator (respond to `GET /translate?from=...&to=...&text=...` with the translated text as plain text), so it can be used directly as a CustomTranslate service for XUnity.AutoTranslator.

### Features

- HTTP API compliant with the CustomTranslate specification (`/translate`, `/health`)
- Automatic detection of supported agent CLIs and server start with the selected agent (only one can listen at a time)
- Agent pool: starts and verifies at least one reusable agent process before listening, translates in parallel up to the configured concurrency, and queues excess requests. Processes are replaced after the configured lifetime or usage limit
- Translation hint management: register a summary of the target app to get translations that fit the content
- Activity log view (latest 200 entries with auto-scroll)
- Preserves line breaks, whitespace and markup; filters dynamic values (e.g. FPS counters) and texts that need no translation

### Supported agent CLIs

| Agent CLI | Command | Package | Default concurrency |
| --- | --- | --- | --- |
| Claude Code | `claude` | `@anthropic-ai/claude-code` | 5 |
| Codex CLI | `codex` | `@openai/codex` | 5 |
| Grok CLI | `grok` | `@xai-official/grok` | 5 |
| opencode | `opencode` | `opencode-ai` | 1 |
| OpenCode (Ollama) | `ollama launch opencode --model <model>` | Ollama + opencode | 1 |

Install each agent CLI beforehand and complete its login (authentication) procedure.
OpenCode (Ollama) requires both Ollama and OpenCode. Set the Ollama model name in its agent settings before starting it.

### XUnity.AutoTranslator configuration

Add the following to `AutoTranslatorConfig.ini`:

```ini
[Service]
Endpoint=CustomTranslate

[Custom]
Url=http://127.0.0.1:4660/translate
```

If you change the listen address or port, update `Url` accordingly.

### API sample

Translation request (CustomTranslate specification):

```http
GET http://127.0.0.1:4660/translate?from=en&to=ja&text=Hello
```

Response (200, text/plain):

```text
こんにちは
```

Health check:

```http
GET http://127.0.0.1:4660/health
```

Response (200, text/plain):

```text
ok
```

Quick check with curl:

```bash
curl "http://127.0.0.1:4660/translate?from=en&to=ja&text=Hello"
```

### Usage

1. Start the app and review/save the settings in the "Common Settings" tab: listen address (default 127.0.0.1), port (default 4660), fallback languages, and agent process lifetime (default 300 seconds).
2. Optionally register a summary of the target app in the "Translation Hints" tab.
3. In the "Server" tab, expand the accordion of the agent CLI you want to use, configure the concurrency, maximum process uses, and translation hint, and save.
4. Press the "Start" button on the agent's header row to start the translation server (other agents cannot be started while one is running).
5. Check translation requests/results in the "Logs" tab.

### Settings file

Settings are stored in `~/.agent_cli_translate_server/settings.json`.

## 2. Supported OS

- Windows 10/11
- macOS 10.15+
- Linux (Debian/RHEL families)

Note: This project does not code-sign Windows builds. If SmartScreen shows a warning, choose "More info" then "Run anyway".

## 3. Developer Reference

### Requirements

- Node.js 22.x or later
- yarn 4
- Git

### Installation

```bash
# Clone the repository
git clone <repository-url>
cd <repository-name>

# Install dependencies
yarn install

# Start in development mode
yarn dev
```

DevTools during development:

- DevTools opens automatically in detached mode
- Toggle with F12 or Ctrl+Shift+I (Cmd+Option+I on macOS)

### Build / Distribution

- Windows: `yarn dist:win`
- macOS: `yarn dist:mac`
- Linux: `yarn dist:linux`

In development the app loads `<http://localhost:3001>` with BrowserRouter; distribution builds load `dist/renderer/index.html` with HashRouter.

### Releasing directly to GitHub (for auto update)

These commands upload build artifacts and `latest*.yml` (auto-update metadata) directly to the GitHub repository configured under `publish:` in `electron-builder.yml`. Because of the `releaseType: draft` setting, all commands aggregate into the **same draft release of the same version** on GitHub. Once all platforms are uploaded, press "Publish release" in the GitHub UI to deliver it to users.

- Windows: `yarn release:win`
- macOS: `yarn release:mac`
- Linux: `yarn release:linux`

Set a GitHub Personal Access Token (`public_repo` scope) to the `GH_TOKEN` environment variable before running.

```bash
export GH_TOKEN="ghp_xxxxxxxxxxxxxxxxxxxx"
```

When building each platform on separate machines, make sure `version` in `package.json` matches on all machines, then run the corresponding `release:*` on each machine.

### macOS prerequisites: environment variables for signing/notarization

To build with signing and notarization for macOS, set the following environment variables before running `yarn dist:mac`.

```bash
export APPLE_ID="your-apple-id@example.com"
export APPLE_APP_SPECIFIC_PASSWORD="xxxx-xxxx-xxxx-xxxx"
export APPLE_TEAM_ID="XXXXXXXXXX"
```

### Windows prerequisites: Developer Mode

To run/test unsigned local builds on Windows, enable Developer Mode.

1. Settings -> Privacy & security -> For developers
2. Turn on "Developer Mode"
3. Restart the OS

### Project structure (excerpt)

```text
src/
├── main/                  # Electron main: IPC / managers
│   ├── index.ts           # startup, window creation, service initialization
│   ├── ipc/               # IPC handlers
│   ├── services/          # translation server, agent pool, etc.
│   └── utils/             # utilities
├── preload/               # safely bridges APIs to the renderer
├── renderer/              # React + MUI UI
├── shared/                # types, constants (defaults / storage paths), data models
└── public/                # icons etc.
```

See [Documents/システム仕様.md](Documents/システム仕様.md) and [Documents/テーブル定義.md](Documents/テーブル定義.md) for details (Japanese).

### Technologies

- **Electron**
- **React (MUI v9)**
- **TypeScript**
- **Zustand**
- **i18next**
- **Vite**

### Creating the Windows icon

```exec
magick public/icon.png -define icon:auto-resize=256,128,96,64,48,32,24,16 public/icon.ico
```

## License

MIT License
