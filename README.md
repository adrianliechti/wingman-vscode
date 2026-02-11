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
| Wingman GPT | `gpt-5.2`, `gpt-5.1`, `gpt-5` |
| Wingman GPT Mini | `gpt-5-mini` |
| Wingman Codex | `gpt-5.3-codex`, `gpt-5.2-codex`, `gpt-5.1-codex-max`, `gpt-5.1-codex`, `gpt-5-codex` |
| Wingman Codex Mini | `gpt-5.1-codex-mini` |
| Wingman Gemini Pro | `gemini-3-pro`, `gemini-3-pro-preview`, `gemini-2.5-pro` |
| Wingman Gemini Flash | `gemini-3-flash`, `gemini-3-flash-preview`, `gemini-2.5-flash` |
| Wingman Claude Opus | `claude-opus-4-6`, `claude-opus-4-5` |
| Wingman Claude Sonnet | `claude-sonnet-4-5` |
| Wingman Claude Haiku | `claude-haiku-4-5` |
| Wingman GLM | `glm-5`, `glm-4.7` |
| Wingman GLM Flash | `glm-4.7-flash` |

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
