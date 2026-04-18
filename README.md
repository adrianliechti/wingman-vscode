# Wingman AI — VS Code Extension

This extension integrates Wingman AI directly into VS Code's Copilot Chat, giving you access to multiple model families through a single extension.

> **⚠️ Important Notice:** This extension requires the [Wingman AI Platform](https://github.com/adrianliechti/wingman) and should not be installed unless you are running a compatible Wingman backend.

## Features

- **Copilot Chat integration** — registers as a VS Code Language Model Chat Provider, usable in Copilot Chat and any extension that consumes the Language Model API
- **Multi-vendor model support** — automatically discovers available models from your backend and exposes them as selectable chat models
- **Streaming responses** — real-time token streaming for fast, interactive conversations
- **Tool calling** — full support for function/tool calling workflows
- **Image input** — send images as part of your chat context
- **Lazy activation** — only loads when a Wingman model is requested

## Supported Models

The extension auto-discovers models from your backend. The following model families are supported:

| Chat Model | Model IDs |
|---|---|
| Wingman GPT 5.4 | `gpt-5.4` |
| Wingman GPT 5.4 mini | `gpt-5.4-mini` |
| Wingman GPT 5.2 | `gpt-5.2` |
| Wingman GPT 5.1 | `gpt-5.1` |
| Wingman Codex 5.3 | `gpt-5.3-codex` |
| Wingman Codex 5.2 | `gpt-5.2-codex` |
| Wingman Gemini 3.1 Pro | `gemini-3.1-pro-preview` |
| Wingman Gemini 3 Pro | `gemini-3-pro-preview` |
| Wingman Gemini 3 Flash | `gemini-3-flash-preview` |
| Wingman Opus 4.7 | `claude-opus-4-7` |
| Wingman Opus 4.6 | `claude-opus-4-6` |
| Wingman Opus 4.5 | `claude-opus-4-5` |
| Wingman Sonnet 4.6 | `claude-sonnet-4-6` |
| Wingman Sonnet 4.5 | `claude-sonnet-4-5` |
| Wingman Haiku 4.6 | `claude-haiku-4-6` |
| Wingman Haiku 4.5 | `claude-haiku-4-5` |
| Wingman Devstral | `devstral` |
| Wingman Devstral Medium | `devstral-medium`, `devstral-medium-latest` |
| Wingman Devstral Small | `devstral-small`, `devstral-small-latest` |
| Wingman GLM 5 | `glm-5` |
| Wingman GLM 4.7 | `glm-4.7` |
| Wingman GLM 4.7 Flash | `glm-4.7-flash` |
| Wingman Qwen 3.5 | `qwen3.5` |
| Wingman Qwen 3 | `qwen3-next`, `qwen3` |
| Wingman Qwen Coder | `qwen3-coder-next`, `qwen3-coder` |

The extension picks the first available model from each group based on what your backend reports.

## Configuration

| Setting | Description | Default |
|---|---|---|
| `wingman.baseUrl` | Base URL of your Wingman API | `http://localhost:4242/v1` |
| `wingman.apiKey` | API key for authentication | _(empty)_ |

## Requirements

- VS Code `1.109.0` or later
- A running [Wingman AI](https://github.com/adrianliechti/wingman)

## License

[MIT](LICENSE)
