# Change Log

All notable changes to the "wingman" extension are tracked here.

Reference: [Keep a Changelog](http://keepachangelog.com/)

## [0.5.2] - 2026-11-22

- Fix agent host startup on Windows when a launcher command starts with an unquoted absolute `.exe` path containing spaces, such as `C:\Program Files\tool\helper.exe wingman`. This works in both the `path` file and the `wingman.agentHost.executable` setting.
- When a Windows launcher command ends in `wingman cli`, drop the trailing `cli` so the helper receives `wingman host --port 9100`.

## [0.5.0] - 2026-11-22

- With `wingman-agent` installed, open the **Wingman** panel in the Secondary Side Bar or run **Wingman: Open Chat** in a trusted local workspace. The panel connects to Wingman's built-in agent through the shared host and works without Copilot Chat.
- Choose a model, Agent or Plan mode, and reasoning effort. Attach workspace files or editor selections, queue follow-ups, and respond to approvals and questions in the transcript.
- Reopen sessions from the current folder's history and rename the active session. The panel restores the last open session after reloading and shares sessions with VS Code Chat and the Agents window.
- The shared agent host now runs even when VS Code's AI features or remote agent hosts are turned off. Starting the host from VS Code requires 1.144 or later. On older supported versions, start it in a terminal with `wingman host`.
- Read the agent's launcher from `$WINGMAN_HOME/path` when `WINGMAN_HOME` is set, matching where `wingman-agent` records it. The host the extension starts uses the same `WINGMAN_HOME`.

## [0.4.4] - 2026-11-20

- Add Gemini 4 Neon and Inkling 2 Mini with image input, tool use, reasoning effort controls, and 1M-token context windows. Gemini 4 Neon allows up to 65,536 output tokens and Inkling 2 Mini up to 131,072.

## [0.4.3] - 2026-11-17

- Add GPT 6.2 Astra and GPT 6.2 Sol with image input, tool use, and Thinking Effort from `low` through `max`.

## [0.4.2] - 2026-11-16

- Run one shared `wingman host` for all windows and register it in user settings instead of each project's `.vscode/settings.json`.
- When the window running the host closes, another open window takes over. Stop Agent Host stops it for all windows.

## [0.4.1] - 2026-11-15

- Support the VS Code Agents window with one authenticated `wingman host` process for all projects, including startup without an open folder and continued operation across folder changes.
- Fix renamed agent hosts failing to reconnect after a restart. Refresh the connection token and recreate VS Code's connection while preserving the custom name, other options, and user-owned entry on stop.
- Detect the agent host's WebSocket URL directly in startup output, without requiring the `AHP endpoint:` label.
- Discover the agent command from `~/.wingman/path`, with an explicit executable setting taking precedence and `wingman` on PATH as fallback. Support proxy launchers such as `/bin/devtool wingman` and quoted paths and arguments.
- Remove GPT models older than 5.6, including Codex 5.2/5.3, and Claude models older than 5.5 except Fable 5.2. Update test fixtures to supported models.
- Support only Gemini 4 Carbon, Argon, and Hydrogen, with shared 1M context windows, synchronous output limits, and model-specific thinking effort options.
- Replace older GLM entries with GLM 5.3 and GLM 5.3 Flash, including 1M context windows, always-on reasoning effort options, and image input for Flash.
- Remove Devstral and older Qwen entries. Curate Qwen support to 3.8 Max, Flash, and 27B, grouping known snapshots and provider-qualified aliases into one entry per model. Use 27B's native context window for local deployments.
- Add Inkling 2 Small with image input, tool use, reasoning effort options, and a 1M context window with a 128K output budget.
- Add Mistral Large 4 and Small 4 with native/OpenRouter aliases, image input, tool use, and current reasoning effort options. Large 4 uses a 1M context window and 256K output limit; Small 4 uses a 256K window with a 64K output budget.
- Send Bearer authentication through Custom Endpoint request headers for all protocols, fixing authenticated Anthropic Messages requests to Wingman.
- Activate Copilot before model sync, explain missing/disabled provider failures separately from gateway failures, and retry when providers become available.
- Add an isolated VS Code/Copilot integration check for discovery, authentication, streaming, and tool-call continuations, with optional live gateway checks.
- Automatically start Wingman's AHP server for trusted local projects and configure the available VS Code agent host setting. Add Start/Stop Agent Host commands, executable and auto-start settings, and cleanup that preserves existing host entries.
- Added Fable 5.2 with a 1M-token context window, 128K output tokens, vision, tool use, and adaptive thinking with effort from `low` through `max`.
- Sync API key changes to VS Code's saved Wingman chat credential, including when the available models have not changed.

## [0.3.13] - 2026-10-27

- Added GPT 6.1 Terra with a 1.05M-token context window, 128K output tokens, vision, tool use, and reasoning effort from `none` through `max`.
- Prefer GPT 6.1 Terra for general utility tasks when available, preserving existing user selections.
- Added Gemini 4 Argon with a shared 1M-token context window, 64K output tokens, vision, tool use, and thinking.
- Updated build dependencies and TypeScript configuration for TypeScript 6.0.
- Production builds and VSIX packaging now check types and lint before bundling.
- Fixed the debugger's pre-launch build task waiting for TypeScript watch output from esbuild.
- Keep VS Code API typings aligned with the minimum supported version, 1.134.

## [0.3.12] - 2026-10-11

- Added Haiku 5.5 with a 1M-token context window, 128K output tokens, vision, tool use, and adaptive thinking.

## [0.3.11] - 2026-09-29

- Added GPT 6.1 Sol with a 1.05M-token context window, 128K output tokens, vision, tool use, and reasoning effort from `low` through `max`.
- Added `none` to GPT 5.5's Thinking Effort options.

## [0.3.10] - 2026-09-29

- Added Sonnet 5.5 with a 1M-token context window, 128K output tokens, vision, tool use, and adaptive thinking.

## [0.3.9] - 2026-09-24

- Thinking Effort now works for Claude models.
- Fixed chat requests for base URLs without `/v1`.
- Requires VS Code 1.134 or later.

## [0.3.8] - 2026-09-23

- Added GPT 6 Astra, GPT 6 Sol, GPT 6 Luna, Opus 5.5 and Fable 5.1.
- Wingman now picks default models for background tasks such as titles and commit messages.

## [0.3.6] - 2026-07-25

- Token limits now follow each vendor's context window.

## [0.3.5] - 2026-07-25

- Added Opus 5 and fixed Thinking Effort levels.
- Raised the Sonnet 5 and Sonnet 4.6 output limit to 128K.

## [0.3.4] - 2026-07-13

- Simplified GPT model names.

## [0.3.3] - 2026-07-09

- Added GPT 5.6.

## [0.3.2] - 2026-07-01

- Added Sonnet 5.

## [0.3.1] - 2026-06-09

- Claude models now use the Anthropic Messages API.

## [0.3.0] - 2026-06-04

- Models are now served by VS Code's built-in Custom Endpoint provider.

## [0.2.2] - 2026-05-14

- Removed the MCP bridge. The extension no longer starts a local HTTP server, writes lockfiles under `~/.wingman/bridge/`, or exposes VS Code language features over MCP. You can safely delete that directory after upgrading.
- Dropped `@hono/node-server`, `@modelcontextprotocol/sdk`, and `hono` dependencies.

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
