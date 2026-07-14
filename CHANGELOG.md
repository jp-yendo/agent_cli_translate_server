# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/),
and this project adheres to [Semantic Versioning](https://semver.org/).

## [Unreleased]

## [v0.2.0] - 2026-07-14

### Added

- API-based translation engines in addition to agent CLIs: Ollama, an OpenAI-compatible API, and an Anthropic-compatible API.

### Changed

- The translation server status now appears in the title bar (next to the version) and in detail on the Logs screen, instead of on the Server screen.
- The translation hint is now a single shared setting for all engines, selectable at the top of the Server screen and saved immediately.
- Refined the translation quality and applied consistent prompts across all engines, with dedicated handling for translation-specialized models (Hy-MT2).

### Removed

- Removed the "Re-detect" button from the Server screen.
