# Change Log

All notable changes to the "wingman" extension will be documented in this file.

Check [Keep a Changelog](http://keepachangelog.com/) for recommendations on how to structure this file.

## [0.0.13] - 2026-02-19

- Add `gemini-3.1-pro-preview` model support
- Add `claude-sonnet-4-6` model to Wingman Claude Sonnet group
- Add `claude-haiku-4-6` model to Wingman Claude Haiku group
- Add Qwen models: `qwen3.5`, `qwen3-next`, `qwen3`
- Add Qwen Coder models: `qwen3-coder-next`, `qwen3-coder`
- Add Devstral models: `devstral`, `devstral-medium`, `devstral-medium-latest`
- Add Devstral Small models: `devstral-small`, `devstral-small-latest`
- Add `gpt-5.3-codex-spark` to Wingman Codex Mini group

## [0.0.12] - 2026-02-11

- Add GLM models: `glm-5`, `glm-4.7`, `glm-4.7-flash`
- Split OpenAI models into separate GPT and Codex groups
- Simplify provider with inline per-model limits and capabilities

## [0.0.11] - 2026-02-05

- Add Gemini models: `gemini-3-pro-preview`, `gemini-2.5-pro`, `gemini-3-flash-preview`
- Add `claude-opus-4-6` support
- Add `gpt-5.3-codex` support
- Introduce per-model token limits instead of global constants

## [0.0.10] - 2026-01-12

- Adjust context window: reduce maxInputTokens to 127,805 and maxOutputTokens to 16,000
- Add lazy loading via `onLanguageModelChat:wingman` activation event
- Add `Wingman AI` log output channel
- Add client caching with configuration change detection
- Add cancellation token support and proper error handling
- Add safe JSON parsing for tool arguments

## [0.0.9] - 2026-01-09

- Add image input support (base64-encoded `image_url` content parts)
- Add system message forwarding
- Fix consecutive assistant message merging for tool calls

## [0.0.8] - 2026-01-08

- Add Claude models: `claude-sonnet-4-5`, `claude-opus-4-5`, `claude-haiku-4-5`
- First multi-vendor model support (OpenAI + Anthropic Claude)

## [0.0.7] - 2025-12-21

- Add `gpt-5.2-codex` and `gpt-5.2` models
- Add `gpt-5.1-codex-max` model

## [0.0.6] - 2025-11-14

- Add `gpt-5.1` and `gpt-5.1-codex` models
- Increase maxInputTokens to 272,000 and maxOutputTokens to 128,000

## [0.0.5] - 2025-11-12

- Fix user message role assignment
- Add duck-typing helper for `LanguageModelToolResultPart`
- Refactor message content building with proper part collection

## [0.0.4] - 2025-11-12

- Add dynamic model discovery from backend via `models.list()`
- Move configuration to VS Code settings (`wingman.baseUrl`, `wingman.apiKey`)
- Add `tool_choice` support (required/auto based on `toolMode`)

## [0.0.3] - 2025-09-13

- Add streaming support via `chat.completions.stream()`

## [0.0.2] - 2025-09-13

- Implement token count estimation (`Math.ceil(length / 4)`)
- Filter out literal `"undefined"` message parts

## [0.0.1] - 2025-09-12

- Initial release with OpenAI-compatible Language Model Chat Provider