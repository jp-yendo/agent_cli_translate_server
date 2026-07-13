# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/),
and this project adheres to [Semantic Versioning](https://semver.org/).

## [Unreleased]

### Added

- Initial release: GUI translation server for XUnity.AutoTranslator's CustomTranslate endpoint powered by local agent CLIs (Claude Code, Codex CLI, Grok CLI, opencode).
- Server screen that detects installed agent CLIs and starts/stops the translation server with the selected agent (only one agent can listen at a time).
- Per-agent settings: maximum number of concurrent agents and the translation hint to use.
- Agent pooling: agent processes are kept alive and reused across requests to minimize startup overhead; requests beyond the concurrency limit wait in a queue, and agents unused beyond the retention period are terminated automatically. One warm agent is always kept ready so the first translation stays fast.
- Common settings: listen address, port, fallback source/target languages, and agent retention period.
- Translation hint management to register, edit, and delete app summaries that improve translation quality.
- Activity log view showing the latest 200 translation requests and results with optional auto-scroll.
- Japanese and English user interface with a light/dark theme; both preferences can be changed in the common settings and are remembered across restarts (initialized from the OS on first launch).
- Navigation embedded in the window caption, with a gear icon for the common settings and a burger menu for switching screens.
