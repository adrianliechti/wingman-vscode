# Wingman AI for VS Code

Use models from your [Wingman AI Platform](https://github.com/adrianliechti/wingman) in VS Code's Copilot Chat. The extension adds your available models to the chat model picker and keeps the list up to date.

## Requirements

- VS Code `1.123.0` or later
- A running Wingman AI backend

## Getting started

1. Start your Wingman backend and install the **Wingman AI** extension.
2. Open VS Code Settings and search for **Wingman**. Set the base URL and API key if your backend requires different values from the defaults below.
3. Run **Wingman: Sync Models** from the Command Palette.
4. Open Copilot Chat and choose a model from the **Wingman** group in the model picker.

Models sync automatically when VS Code starts. Run **Wingman: Sync Models** again after changing your connection settings or the models available on your backend.

## Features

- Choose from OpenAI, Anthropic, Gemini, and other supported models available through your backend.
- Use tools, images, and reasoning in Copilot Chat where supported by the selected model.
- Adjust **Thinking Effort** for compatible models.
- Use Wingman models for summaries, titles, commit messages, and other background tasks.

## Configuration

| Setting | Description | Default |
|---|---|---|
| `wingman.baseUrl` | Base URL of your Wingman API | `http://localhost:4242/v1` |
| `wingman.apiKey` | API key for authentication | `-` |

For a local backend without authentication, keep the default API key.

To change a saved API key, update `wingman.apiKey`, then run **Open Language Models File** from the Command Palette, remove the **Wingman** group, and run **Wingman: Sync Models** again.

### Utility models

On VS Code versions that support utility model settings, Wingman chooses defaults for background tasks:

| Setting | Used for | Preferred model |
|---|---|---|
| `chat.utilityModel` | General tasks such as titles and summaries | GPT 5.6 Terra |
| `chat.utilitySmallModel` | Lightweight tasks such as commit messages and rename suggestions | GPT 6 Luna |

If a preferred model is unavailable, Wingman chooses another supported model. Both settings may use the same model.

You can change either setting in VS Code Settings. Existing choices, including **Default**, are preserved unless they select a **Custom Endpoint** model that no longer exists; those selections are replaced during sync. Utility settings also apply to background tasks outside Wingman chats.

## Supported models

Only supported models available on your backend appear in the picker.

| Chat Model | Model IDs |
|---|---|
| GPT 6 Astra | `gpt-6-astra` |
| GPT 6 Sol | `gpt-6-sol` |
| GPT 6 Luna | `gpt-6-luna` |
| GPT 5.6 Sol | `gpt-5.6-sol`, `gpt-5.6` |
| GPT 5.6 Luna | `gpt-5.6-luna` |
| GPT 5.6 Terra | `gpt-5.6-terra` |
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
| Fable 5.1 | `claude-fable-5-1` |
| Opus 5.5 | `claude-opus-5-5` |
| Opus 5 | `claude-opus-5` |
| Opus 4.8 | `claude-opus-4-8` |
| Opus 4.7 | `claude-opus-4-7` |
| Opus 4.6 | `claude-opus-4-6` |
| Opus 4.5 | `claude-opus-4-5` |
| Sonnet 5 | `claude-sonnet-5` |
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

## Troubleshooting

If models are missing, check that your Wingman backend is running and that the base URL and API key are correct, then run **Wingman: Sync Models**. For details about sync failures or unsupported models, open VS Code's **Output** panel and select **Wingman AI**.

## License

[MIT](LICENSE)
