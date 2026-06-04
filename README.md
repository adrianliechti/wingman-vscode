# Wingman AI — VS Code Extension

This extension integrates the Wingman AI platform into VS Code's Copilot Chat by configuring the **built-in "Custom Endpoint" language model provider** that ships with VS Code (1.123+). It auto-discovers the models available on your Wingman backend and registers them as a "Wingman" language model group — VS Code itself handles all chat traffic (OpenAI Responses API, streaming, tool calling, thinking, images).

> **⚠️ Important Notice:** This extension requires the [Wingman AI Platform](https://github.com/adrianliechti/wingman) and should not be installed unless you are running a compatible Wingman backend.

## How it works

On first startup (and whenever you run **`Wingman: Sync Models`**), the extension:

1. Queries `GET {baseUrl}/models` on your Wingman backend
2. Matches the reported model IDs against its model catalog (names, token limits, capabilities, reasoning effort levels)
3. Registers a **Wingman** provider group with VS Code's built-in `customendpoint` vendor (`apiType: responses`, `zeroDataRetentionEnabled: true` — requests are stateless, no `previous_response_id` is ever sent)

After that, the models appear in the Copilot Chat model picker. The resulting configuration lives in your VS Code profile's `chatLanguageModels.json` (command: *Open Language Models File*) and can be edited or removed there — re-running `Wingman: Sync Models` after removal re-creates it.

## Features

- **Native Copilot Chat integration** — uses VS Code's built-in OpenAI-compatible provider; no custom wire protocol code
- **Multi-vendor model support** — automatically discovers available models from your backend
- **Zero Data Retention** — Responses API in stateless mode (`store: false`, no `previous_response_id`)
- **Tool calling, vision, thinking** — capabilities forwarded per model
- **Reasoning controls** — per-model "Thinking Effort" picker where supported

## Supported Models

The extension auto-discovers models from your backend. The following model families are supported:

| Chat Model | Model IDs |
|---|---|
| GPT 5.5 | `gpt-5.5` |
| GPT 5.4 | `gpt-5.4` |
| GPT 5.4 mini | `gpt-5.4-mini` |
| GPT 5.2 | `gpt-5.2` |
| GPT 5.1 | `gpt-5.1` |
| Codex 5.3 | `gpt-5.3-codex` |
| Codex 5.2 | `gpt-5.2-codex` |
| Gemini 3.5 Flash | `gemini-3.5-flash` |
| Gemini 3.1 Pro | `gemini-3.1-pro`, `gemini-3.1-pro-preview` |
| Gemini 3 Pro | `gemini-3-pro`, `gemini-3-pro-preview` |
| Gemini 3 Flash | `gemini-3-flash`, `gemini-3-flash-preview` |
| Opus 4.8 | `claude-opus-4-8` |
| Opus 4.7 | `claude-opus-4-7` |
| Opus 4.6 | `claude-opus-4-6` |
| Opus 4.5 | `claude-opus-4-5` |
| Sonnet 4.6 | `claude-sonnet-4-6` |
| Sonnet 4.5 | `claude-sonnet-4-5` |
| Haiku 4.6 | `claude-haiku-4-6` |
| Haiku 4.5 | `claude-haiku-4-5` |
| Devstral Medium | `devstral-medium`, `devstral-medium-latest`, `devstral-latest`, `devstral` |
| Devstral Small | `devstral-small`, `devstral-small-latest` |
| GLM 5.1 | `glm-5.1` |
| GLM 5 | `glm-5` |
| GLM 4.7 | `glm-4.7` |
| GLM 4.7 Flash | `glm-4.7-flash` |
| Qwen 3.7 Max | `qwen3.7-max` |
| Qwen 3.6 | `qwen3.6-plus`, `qwen3.6` |
| Qwen 3.6 Flash | `qwen3.6-flash` |
| Qwen 3.5 | `qwen3.5-plus`, `qwen3.5` |
| Qwen 3 | `qwen3-next`, `qwen3` |
| Qwen 3 Coder | `qwen3-coder-plus`, `qwen3-coder-flash`, `qwen3-coder-next`, `qwen3-coder` |

The extension picks the first available model from each group based on what your backend reports.

## Configuration

| Setting | Description | Default |
|---|---|---|
| `wingman.baseUrl` | Base URL of your Wingman API | `http://localhost:4242/v1` |
| `wingman.apiKey` | API key for authentication | `-` |

Settings are read when syncing. To apply changes, remove the existing "Wingman" group (*Open Language Models File*) and run `Wingman: Sync Models` again.

## Requirements

- VS Code `1.123.0` or later (built-in Copilot Chat with the "Custom Endpoint" provider)
- A running [Wingman AI](https://github.com/adrianliechti/wingman)

## License

[MIT](LICENSE)
