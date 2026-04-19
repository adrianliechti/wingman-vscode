import type * as vscode from "vscode";

import type { ReasoningEffort } from "openai/resources/shared";

export interface ModelInfo extends vscode.LanguageModelChatInformation {}

export interface ModelLimits {
	maxInputTokens: number;
	maxOutputTokens: number;
}

export interface ModelCapabilities {
	toolCalling?: boolean;
	imageInput?: boolean;
}

export interface ModelCandidate {
	id: string[];
	name: string;
	limits: ModelLimits;
	capabilities?: ModelCapabilities;

	/**
	 * Reasoning effort levels this model accepts. When present, the provider
	 * attaches a `configurationSchema` so hosts that support the proposed
	 * `chatProvider` API render a "Thinking Effort" picker.
	 */
	reasoningEffort?: ReasoningEffort[];
}

export const candidates: ModelCandidate[] = [
	// OpenAI models
	{
		id: ["gpt-5.4"],
		name: "Wingman GPT 5.4",
		limits: { maxInputTokens: 400000, maxOutputTokens: 128000 },
		capabilities: { toolCalling: true, imageInput: true },
		reasoningEffort: ["none", "low", "medium", "high", "xhigh"],
	},
	{
		id: ["gpt-5.4-mini"],
		name: "Wingman GPT 5.4 mini",
		limits: { maxInputTokens: 400000, maxOutputTokens: 128000 },
		capabilities: { toolCalling: true, imageInput: true },
		reasoningEffort: ["none", "low", "medium", "high", "xhigh"],
	},
	{
		id: ["gpt-5.2"],
		name: "Wingman GPT 5.2",
		limits: { maxInputTokens: 400000, maxOutputTokens: 128000 },
		capabilities: { toolCalling: true, imageInput: true },
		reasoningEffort: ["none", "low", "medium", "high", "xhigh"],
	},
	{
		id: ["gpt-5.1"],
		name: "Wingman GPT 5.1",
		limits: { maxInputTokens: 400000, maxOutputTokens: 128000 },
		capabilities: { toolCalling: true, imageInput: true },
		reasoningEffort: ["none", "low", "medium", "high"],
	},

	{
		id: ["gpt-5.3-codex"],
		name: "Wingman Codex 5.3",
		limits: { maxInputTokens: 400000, maxOutputTokens: 128000 },
		capabilities: { toolCalling: true, imageInput: true },
		reasoningEffort: ["low", "medium", "high", "xhigh"],
	},
	{
		id: ["gpt-5.2-codex"],
		name: "Wingman Codex 5.2",
		limits: { maxInputTokens: 400000, maxOutputTokens: 128000 },
		capabilities: { toolCalling: true, imageInput: true },
		reasoningEffort: ["low", "medium", "high", "xhigh"],
	},

	// Gemini models
	{
		id: ["gemini-3.1-pro-preview"],
		name: "Wingman Gemini 3.1 Pro",
		limits: { maxInputTokens: 200000, maxOutputTokens: 64000 },
		capabilities: { toolCalling: true, imageInput: true },
	},
	{
		id: ["gemini-3-pro-preview"],
		name: "Wingman Gemini 3 Pro",
		limits: { maxInputTokens: 200000, maxOutputTokens: 64000 },
		capabilities: { toolCalling: true, imageInput: true },
	},
	{
		id: ["gemini-3-flash-preview"],
		name: "Wingman Gemini 3 Flash",
		limits: { maxInputTokens: 200000, maxOutputTokens: 64000 },
		capabilities: { toolCalling: true, imageInput: true },
	},

	// Claude models
	{
		id: ["claude-opus-4-7"],
		name: "Wingman Opus 4.7",
		limits: { maxInputTokens: 200000, maxOutputTokens: 128000 },
		capabilities: { toolCalling: true, imageInput: true },
		reasoningEffort: ["none", "low", "medium", "high", "xhigh"],
	},
	{
		id: ["claude-opus-4-6"],
		name: "Wingman Opus 4.6",
		limits: { maxInputTokens: 200000, maxOutputTokens: 128000 },
		capabilities: { toolCalling: true, imageInput: true },
		reasoningEffort: ["none", "low", "medium", "high"],
	},
	{
		id: ["claude-opus-4-5"],
		name: "Wingman Opus 4.5",
		limits: { maxInputTokens: 200000, maxOutputTokens: 64000 },
		capabilities: { toolCalling: true, imageInput: true },
		reasoningEffort: ["none", "low", "medium", "high"],
	},

	{
		id: ["claude-sonnet-4-6"],
		name: "Wingman Sonnet 4.6",
		limits: { maxInputTokens: 200000, maxOutputTokens: 64000 },
		capabilities: { toolCalling: true, imageInput: true },
		reasoningEffort: ["none", "low", "medium", "high"],
	},
	{
		id: ["claude-sonnet-4-5"],
		name: "Wingman Sonnet 4.5",
		limits: { maxInputTokens: 200000, maxOutputTokens: 64000 },
		capabilities: { toolCalling: true, imageInput: true },
		reasoningEffort: ["none", "low", "medium", "high"],
	},

	{
		id: ["claude-haiku-4-6"],
		name: "Wingman Haiku 4.6",
		limits: { maxInputTokens: 200000, maxOutputTokens: 64000 },
		capabilities: { toolCalling: true, imageInput: true },
	},
	{
		id: ["claude-haiku-4-5"],
		name: "Wingman Haiku 4.5",
		limits: { maxInputTokens: 200000, maxOutputTokens: 64000 },
		capabilities: { toolCalling: true, imageInput: true },
	},

	// Devstral models
	{
		id: ["devstral-medium", "devstral-medium-latest", "devstral-latest", "devstral"],
		name: "Wingman Devstral Medium",
		limits: { maxInputTokens: 256000, maxOutputTokens: 256000 },
		capabilities: { toolCalling: true },
	},
	{
		id: ["devstral-small", "devstral-small-latest"],
		name: "Wingman Devstral Small",
		limits: { maxInputTokens: 256000, maxOutputTokens: 256000 },
		capabilities: { toolCalling: true },
	},

	// GLM models
	{
		id: ["glm-5.1"],
		name: "Wingman GLM 5.1",
		limits: { maxInputTokens: 200000, maxOutputTokens: 128000 },
		capabilities: { toolCalling: true },
	},
	{
		id: ["glm-5"],
		name: "Wingman GLM 5",
		limits: { maxInputTokens: 200000, maxOutputTokens: 128000 },
		capabilities: { toolCalling: true },
	},
	{
		id: ["glm-4.7"],
		name: "Wingman GLM 4.7",
		limits: { maxInputTokens: 200000, maxOutputTokens: 128000 },
		capabilities: { toolCalling: true },
	},
	{
		id: ["glm-4.7-flash"],
		name: "Wingman GLM 4.7 Flash",
		limits: { maxInputTokens: 200000, maxOutputTokens: 128000 },
		capabilities: { toolCalling: true },
	},

	// Qwen models
	{
		id: ["qwen3.6-plus", "qwen3.6"],
		name: "Wingman Qwen 3.6",
		limits: { maxInputTokens: 256000, maxOutputTokens: 64000 },
		capabilities: { toolCalling: true },
	},
	{
		id: ["qwen3.5-plus", "qwen3.5"],
		name: "Wingman Qwen 3.5",
		limits: { maxInputTokens: 256000, maxOutputTokens: 64000 },
		capabilities: { toolCalling: true },
	},
	{
		id: ["qwen3-next", "qwen3"],
		name: "Wingman Qwen 3",
		limits: { maxInputTokens: 128000, maxOutputTokens: 16000 },
		capabilities: { toolCalling: true },
	},
	{
		id: ["qwen3-coder-next", "qwen3-coder"],
		name: "Wingman Qwen 3 Coder",
		limits: { maxInputTokens: 256000, maxOutputTokens: 64000 },
		capabilities: { toolCalling: true },
	},
];
