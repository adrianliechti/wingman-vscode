# Change Log

All notable changes to the "wingman" extension are tracked here.

Reference: [Keep a Changelog](http://keepachangelog.com/)

## [0.1.1] - 2026-03-19

- Added reasoning support for Responses API
- Adjusted advertised `maxInputTokens` to reserve room for `maxOutputTokens`.

## [0.1.0] - 2026-03-14

- Migrated to OpenAI Responses API
- Adjusted token calculation to align with the latest VS Code behavior.
- Added `gpt-5.4` support.

## [0.0.13] - 2026-02-19

- Added `gemini-3.1-pro-preview` support.
- Added `claude-sonnet-4-6` to the Wingman Claude Sonnet group.
- Added `claude-haiku-4-6` to the Wingman Claude Haiku group.
- Added Qwen models: `qwen3.5`, `qwen3-next`, `qwen3`.
- Added Qwen Coder models: `qwen3-coder-next`, `qwen3-coder`.
- Added Devstral models: `devstral`, `devstral-medium`, `devstral-medium-latest`.
- Added Devstral Small models: `devstral-small`, `devstral-small-latest`.
- Added `gpt-5.3-codex-spark` to the Wingman Codex Mini group.

## [0.0.12] - 2026-02-11

- Added GLM models: `glm-5`, `glm-4.7`, `glm-4.7-flash`.
- Split OpenAI models into separate GPT and Codex groups.
- Simplified the provider with inline per-model limits and capabilities.

## [0.0.11] - 2026-02-05

- Added Gemini models: `gemini-3-pro-preview`, `gemini-2.5-pro`, `gemini-3-flash-preview`.
- Added `claude-opus-4-6` support.
- Added `gpt-5.3-codex` support.
- Introduced per-model token limits instead of global constants.

## [0.0.10] - 2026-01-12

- Updated context window limits: maxInputTokens `127,805`, maxOutputTokens `16,000`.
- Added lazy loading via `onLanguageModelChat:wingman` activation.
- Added a dedicated `Wingman AI` log output channel.
- Added client caching with configuration change detection.
- Added cancellation token support and improved error handling.
- Added safer JSON parsing for tool arguments.

## [0.0.9] - 2026-01-09

- Added image input support (base64-encoded `image_url` content parts).
- Added system message forwarding.
- Fixed consecutive assistant message merging for tool calls.

## [0.0.8] - 2026-01-08

- Added Claude models: `claude-sonnet-4-5`, `claude-opus-4-5`, `claude-haiku-4-5`.
- Shipped first multi-vendor model support (OpenAI + Anthropic Claude).

## [0.0.7] - 2025-12-21

- Added `gpt-5.2-codex` and `gpt-5.2` models.
- Added `gpt-5.1-codex-max`.

## [0.0.6] - 2025-11-14

- Added `gpt-5.1` and `gpt-5.1-codex`.
- Increased maxInputTokens to `272,000` and maxOutputTokens to `128,000`.

## [0.0.5] - 2025-11-12

- Fixed user message role assignment.
- Added a duck-typing helper for `LanguageModelToolResultPart`.
- Refactored message content building for cleaner part collection.

## [0.0.4] - 2025-11-12

- Added dynamic model discovery from backend via `models.list()`.
- Moved configuration to VS Code settings (`wingman.baseUrl`, `wingman.apiKey`).
- Added `tool_choice` support (`required`/`auto` based on `toolMode`).

## [0.0.3] - 2025-09-13

- Added streaming support via `chat.completions.stream()`.

## [0.0.2] - 2025-09-13

- Implemented token count estimation (`Math.ceil(length / 4)`).
- Filtered out literal `"undefined"` message parts.

## [0.0.1] - 2025-09-12

- Initial release with an OpenAI-compatible Language Model Chat Provider.
