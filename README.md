# Wingman AI for VS Code

Use models from your [Wingman AI Platform](https://github.com/adrianliechti/wingman) in VS Code's Copilot Chat. The extension adds your available models to the chat model picker and keeps the list up to date.

With [wingman-agent](https://github.com/adrianliechti/wingman-agent) installed, the extension can also start Wingman's Agent Host Protocol (AHP) server and connect VS Code Chat to its agents and sessions.

## Requirements

- VS Code `1.134.0` or later
- GitHub Copilot Chat installed and enabled for model integration
- A running Wingman AI backend

## Getting started

1. Start your Wingman backend and install the **Wingman AI** extension.
2. Open VS Code Settings and search for **Wingman**. Set the base URL and API key if your backend requires different values from the defaults below.
3. Run **Wingman: Sync Models** from the Command Palette.
4. Open Copilot Chat and choose a model from the **Wingman** group in the model picker.

Models sync automatically when VS Code starts. Run **Wingman: Sync Models** again after changing your connection settings or the models available on your backend.

Using Wingman models in **Copilot harness** sessions requires `chat.agentHost.byokModels.enabled` (experimental). Current VS Code builds enable it by default; check this setting if models are missing from the harness picker. See [VS Code's BYOK documentation](https://code.visualstudio.com/docs/agent-customization/language-models#bring-your-own-language-model-key).

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
| `wingman.agentHost.autoStart` | Start and configure the agent host when opening a trusted local project | `true` |
| `wingman.agentHost.executable` | Override the Wingman executable path or launcher command | `~/.wingman/path`, then `wingman` on PATH |

For a local backend without authentication, keep the default API key.

To change your API key, update `wingman.apiKey`, then run **Wingman: Sync Models**. Sync updates both model discovery and the saved credential used by VS Code for chat requests. You can also restart VS Code to apply the change.

All three API types use Wingman's Bearer authentication, including the Anthropic Messages endpoint. Model entries contain `Authorization: Bearer ${apiKey}`; Copilot substitutes the credential from VS Code's secret storage when sending a request.

Claude 5.x models use adaptive thinking by default when `thinking` is omitted. Wingman preserves that model default and forwards `output_config.effort` independently, so the Copilot host bridge does not need to explicitly enable thinking for these models. Thinking summaries are hidden by default; requesting visible summaries requires `thinking: {"type": "adaptive", "display": "summarized"}`. See [Claude's thinking defaults](https://platform.claude.com/docs/en/build-with-claude/thinking).

### Wingman agent host

1. Install `wingman-agent` and configure its provider following the [agent setup instructions](https://github.com/adrianliechti/wingman-agent#configure-your-provider). The extension discovers its command from `~/.wingman/path`, falling back to `wingman` on PATH. An explicitly set `wingman.agentHost.executable` takes precedence over the file.
2. Open a trusted local project in a recent VS Code release with `chat.workspaceRemoteAgentHosts`. AHP requires at least VS Code 1.144; editor Chat integration requires the newer workspace host setting.
3. The extension runs `wingman server --no-browser` in the project and registers the address reported by the server. Select **Wingman (your project)** in Chat, then choose an agent and model.
4. In the Agents window, no project needs to be open: the extension runs `wingman host` once for every project. Select **Wingman**, then choose the folder of each session.

The server uses port 9000 when available and chooses another port when needed, so separate windows can run separate hosts. In multi-root workspaces, the first folder is the server's project. The agent uses its own provider configuration; `wingman.baseUrl` and `wingman.apiKey` configure model sync only.

Both `~/.wingman/path` and the executable setting accept an executable path or a launcher command. For example, `/bin/devtool wingman` starts `/bin/devtool wingman server --no-browser`. Quote paths and arguments containing spaces in commands, such as `"/Applications/Dev Tools/devtool" wingman`. Existing bare executable paths with spaces also work. Commands are parsed into executable and arguments; shell expansion is not performed. Missing or empty discovery files, stale absolute executable paths, and malformed discovery commands fall back to `wingman` on PATH.

Wingman is registered only after the executable starts successfully and reports its AHP endpoint. If the binary is missing, automatic startup leaves the host lists untouched and logs the reason without displaying a notification.

In an editor window, the connection is added to `chat.workspaceRemoteAgentHosts` in workspace settings (`.vscode/settings.json` or the `.code-workspace` file). In the Agents window, it uses `chat.remoteAgentHosts` in user settings instead, with a connection token that only that window's host accepts. Existing hosts are preserved. If an existing entry uses the new host's address, its token is refreshed while keeping its name and other options, so renamed hosts can reconnect after a restart. Stopping the server or closing the window removes the extension's entry and restores the previous setting if it has not otherwise changed. VS Code manages the connection once the entry is registered.

Use **Wingman: Start Agent Host** to start or retry, and **Wingman: Stop Agent Host** to stop it for the current window. Set `wingman.agentHost.autoStart` to `false` to keep startup manual; changing it or the executable path stops the current server and applies the new preference. The extension stops its server on shutdown, so stop any active agent tasks before closing the window. SSH, WSL, Dev Container, and other remote workspaces are not yet supported for automatic server startup.

On older VS Code versions, model sync continues to work and agent host startup is skipped. Startup failures, including a missing executable, are logged in **Output → Wingman AI**; the Start command also shows an error message.

### Utility models

Wingman chooses defaults for background tasks:

| Setting | Used for | Preferred model |
|---|---|---|
| `chat.utilityModel` | General tasks such as titles and summaries | GPT 6.1 Terra |
| `chat.utilitySmallModel` | Lightweight tasks such as commit messages and rename suggestions | GPT 6 Luna |

If a preferred model is unavailable, Wingman chooses another supported model. Both settings may use the same model.

You can change either setting in VS Code Settings. Existing choices, including **Default**, are preserved unless they select a **Custom Endpoint** model that no longer exists; those selections are replaced during sync. Utility settings also apply to background tasks outside Wingman chats.

## Supported models

Only supported models available on your backend appear in the picker. GPT support starts at 5.6; Claude support starts at 5.5, with Fable 5.2 also included.

[GPT 6.1 Sol](https://developers.openai.com/api/docs/models/gpt-6.1-sol) supports a 1.05M-token context window, up to 128K output tokens, image input, tool use, and reasoning. Its **Thinking Effort** options are `low`, `medium`, `high`, `xhigh`, and `max`.

[GPT 6.1 Terra](https://developers.openai.com/api/docs/models/gpt-6.1-terra) supports a 1.05M-token context window, up to 128K output tokens, image input, tool use, and reasoning. Its **Thinking Effort** options are `none`, `low`, `medium`, `high`, `xhigh`, and `max`.

[Sonnet 5.5](https://platform.claude.com/docs/en/models/sonnet-5-5/overview) supports a 1M-token context window, up to 128K output tokens, image input, tool use, and adaptive thinking. Its **Thinking Effort** options are `low`, `medium`, `high`, `xhigh`, and `max`.

[Fable 5.2](https://platform.claude.com/docs/en/models/fable-5-2/overview) supports a 1M-token context window, up to 128K output tokens, image input, tool use, and always-on adaptive thinking. Its **Thinking Effort** options are `low`, `medium`, `high`, `xhigh`, and `max`. Anthropic requires 30-day data retention unless expressly authorized otherwise.

[Gemini 4 Carbon](https://aistudio.google.com/docs/models/gemini-4-carbon), [Argon](https://aistudio.google.com/docs/models/gemini-4-argon), and [Hydrogen](https://aistudio.google.com/docs/models/gemini-4-hydrogen) use a shared 1,048,576-token context window and a 65,536-token synchronous output limit, with image input, tool use, and reasoning. Carbon and Argon offer `low`, `medium`, and `high` thinking effort; Hydrogen also offers `xhigh`. Google's separate long-decode mode is not used by this integration.

[GLM 5.3](https://docs.z.ai/guides/llm/glm-5.3) and [GLM 5.3 Flash](https://docs.z.ai/guides/vlm/glm-5.3-flash) support a 1M-token context window, 128K output tokens, tool use, and always-on reasoning with `low`, `high`, and `max` effort. GLM 5.3 accepts text; Flash also accepts images.

Qwen support focuses on [3.8 Max](https://openrouter.ai/qwen/qwen3.8-max-0902), [3.8 Flash](https://openrouter.ai/qwen/qwen3.8-flash), and [3.8 27B](https://huggingface.co/Qwen/Qwen3.8-27B). They support images, tool use, and reasoning. Max and 27B offer `low`, `medium`, and `xhigh` effort; Flash uses its default reasoning configuration. The 27B entry uses its native 262,144-token window for local deployment; larger contexts require server-side scaling. Stable names, listed snapshots, and provider-qualified IDs resolve to one entry per model, using the first available ID in the order below.

[Inkling 2 Small](https://huggingface.co/thinkingmachines/Inkling-2-Small) supports image input, tool use, and reasoning. The extension configures a 1,048,576-token context window with a 131,072-token output budget, leaving most of the shared window available for project context.

[Mistral Large 4](https://openrouter.ai/mistralai/mistral-large-4-0) supports a 1,048,576-token context window and up to 262,144 output tokens. [Mistral Small 4](https://docs.mistral.ai/models/mistral-small-4-0-26-03) has a shared 262,144-token context window; the extension reserves 65,536 tokens for output to leave room for project context. Both support images and tool use. Following [Mistral's current reasoning settings](https://docs.mistral.ai/inference/conversations/reasoning), Large 4 offers `low`, `medium`, and `high`; Small 4 offers `none` and `high`.

| Chat Model | Model IDs |
|---|---|
| GPT 6 Astra | `gpt-6-astra` |
| GPT 6.1 Sol | `gpt-6.1-sol` |
| GPT 6.1 Terra | `gpt-6.1-terra` |
| GPT 6 Sol | `gpt-6-sol` |
| GPT 6 Luna | `gpt-6-luna` |
| GPT 5.6 Sol | `gpt-5.6-sol`, `gpt-5.6` |
| GPT 5.6 Luna | `gpt-5.6-luna` |
| GPT 5.6 Terra | `gpt-5.6-terra` |
| Gemini 4 Carbon | `gemini-4-carbon` |
| Gemini 4 Argon | `gemini-4-argon` |
| Gemini 4 Hydrogen | `gemini-4-hydrogen` |
| Fable 5.2 | `claude-fable-5-2` |
| Opus 5.5 | `claude-opus-5-5` |
| Sonnet 5.5 | `claude-sonnet-5-5` |
| Haiku 5.5 | `claude-haiku-5-5` |
| GLM 5.3 | `glm-5.3` |
| GLM 5.3 Flash | `glm-5.3-flash` |
| Qwen 3.8 Max | `qwen3.8-max`, `qwen3.8-max-0902`, `qwen3.8-max-2026-09-02`, `qwen/qwen3.8-max-0902` |
| Qwen 3.8 Flash | `qwen3.8-flash`, `qwen/qwen3.8-flash` |
| Qwen 3.8 27B | `qwen3.8-27b`, `Qwen/Qwen3.8-27B`, `qwen/qwen3.8-27b` |
| Inkling 2 Small | `inkling-2-small`, `thinkingmachines/Inkling-2-Small`, `thinkingmachines/inkling-2-small` |
| Mistral Large 4 | `mistral-large-4`, `mistral-large-4-0`, `mistralai/mistral-large-4-0` |
| Mistral Small 4 | `mistral-small-4`, `mistral-small-2603`, `mistralai/mistral-small-2603` |

## Troubleshooting

If models are missing, check that your Wingman backend is running and that the base URL and API key are correct, then run **Wingman: Sync Models**. For details about sync failures or unsupported models, open VS Code's **Output** panel and select **Wingman AI**.

If VS Code reports that the Custom Endpoint vendor is unavailable, install or enable **GitHub Copilot Chat** (`GitHub.copilot-chat`) and check your organization's BYOK policy. Fresh VS Code profiles can have bundled Copilot disabled until Chat setup is completed. Wingman activates the provider before sync and retries when extensions or models become available. Provider failures are separate from gateway connection failures; the Wingman AHP host does not require Copilot.

## Integration checks

`npm run test:custom-endpoints` launches VS Code in a disposable profile and verifies discovery, secret-backed Bearer authentication, all three API paths, streamed tool calls, and tool-result continuations against a local fixture server. It enables bundled Copilot only in that test profile. Set `VSCODE_EXECUTABLE_PATH` to test an existing VS Code executable; otherwise the runner downloads stable VS Code.

Set `WINGMAN_LIVE_URL` to additionally send short prompts to a running gateway using GPT 6 Luna, Claude Haiku 5.5, and Gemini 4 Argon. This optional check requires those models and uses their configured providers. `WINGMAN_LIVE_API_KEY` defaults to `-`. The runner prints the temporary profile path for inspection and does not modify your normal VS Code profile.

## License

[MIT](LICENSE)
