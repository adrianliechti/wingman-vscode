import type * as vscode from "vscode";

import type { ReasoningEffort } from "openai/resources/shared";

export interface ModelInfo extends vscode.LanguageModelChatInformation {}

const providerModelPrefix = "wingman/";

interface ModelLimits {
	/**
	 * VS Code expects the prompt/input budget here, not the total context
	 * window when a provider documents input + output together.
	 */
	maxInputTokens: number;
	maxOutputTokens: number;
}

interface ModelCapabilities {
	toolCalling?: boolean;
	imageInput?: boolean;
}

interface ModelCandidate {
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

const candidates: ModelCandidate[] = [
	// OpenAI models
	{
		id: ["gpt-5.5"],
		name: "Wingman GPT 5.5",
		limits: { maxInputTokens: 922000, maxOutputTokens: 128000 },
		capabilities: { toolCalling: true, imageInput: true },
		reasoningEffort: ["none", "low", "medium", "high", "xhigh"],
	},
	{
		id: ["gpt-5.4"],
		name: "Wingman GPT 5.4",
		limits: { maxInputTokens: 922000, maxOutputTokens: 128000 },
		capabilities: { toolCalling: true, imageInput: true },
		reasoningEffort: ["none", "low", "medium", "high", "xhigh"],
	},
	{
		id: ["gpt-5.4-mini"],
		name: "Wingman GPT 5.4 mini",
		limits: { maxInputTokens: 272000, maxOutputTokens: 128000 },
		capabilities: { toolCalling: true, imageInput: true },
		reasoningEffort: ["none", "low", "medium", "high", "xhigh"],
	},
	{
		id: ["gpt-5.2"],
		name: "Wingman GPT 5.2",
		limits: { maxInputTokens: 272000, maxOutputTokens: 128000 },
		capabilities: { toolCalling: true, imageInput: true },
		reasoningEffort: ["none", "low", "medium", "high", "xhigh"],
	},
	{
		id: ["gpt-5.1"],
		name: "Wingman GPT 5.1",
		limits: { maxInputTokens: 272000, maxOutputTokens: 128000 },
		capabilities: { toolCalling: true, imageInput: true },
		reasoningEffort: ["none", "low", "medium", "high"],
	},

	{
		id: ["gpt-5.3-codex"],
		name: "Wingman Codex 5.3",
		limits: { maxInputTokens: 272000, maxOutputTokens: 128000 },
		capabilities: { toolCalling: true, imageInput: true },
		reasoningEffort: ["low", "medium", "high", "xhigh"],
	},
	{
		id: ["gpt-5.2-codex"],
		name: "Wingman Codex 5.2",
		limits: { maxInputTokens: 272000, maxOutputTokens: 128000 },
		capabilities: { toolCalling: true, imageInput: true },
		reasoningEffort: ["low", "medium", "high", "xhigh"],
	},

	// Gemini models
	{
		id: ["gemini-3.5-flash"],
		name: "Wingman Gemini 3.5 Flash",
		limits: { maxInputTokens: 1048576, maxOutputTokens: 65536 },
		capabilities: { toolCalling: true, imageInput: true },
	},
	{
		id: ["gemini-3.1-pro", "gemini-3.1-pro-preview"],
		name: "Wingman Gemini 3.1 Pro",
		limits: { maxInputTokens: 1048576, maxOutputTokens: 65536 },
		capabilities: { toolCalling: true, imageInput: true },
	},
	{
		id: ["gemini-3-pro", "gemini-3-pro-preview"],
		name: "Wingman Gemini 3 Pro",
		limits: { maxInputTokens: 1048576, maxOutputTokens: 65536 },
		capabilities: { toolCalling: true, imageInput: true },
	},
	{
		id: ["gemini-3-flash", "gemini-3-flash-preview"],
		name: "Wingman Gemini 3 Flash",
		limits: { maxInputTokens: 1048576, maxOutputTokens: 65536 },
		capabilities: { toolCalling: true, imageInput: true },
	},

	// Claude models
	{
		id: ["claude-opus-4-7"],
		name: "Wingman Opus 4.7",
		limits: { maxInputTokens: 1000000, maxOutputTokens: 128000 },
		capabilities: { toolCalling: true, imageInput: true },
		reasoningEffort: ["none", "low", "medium", "high", "xhigh"],
	},
	{
		id: ["claude-opus-4-6"],
		name: "Wingman Opus 4.6",
		limits: { maxInputTokens: 1000000, maxOutputTokens: 128000 },
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
		limits: { maxInputTokens: 1000000, maxOutputTokens: 64000 },
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
		limits: { maxInputTokens: 262144, maxOutputTokens: 262144 },
		capabilities: { toolCalling: true },
	},
	{
		id: ["devstral-small", "devstral-small-latest"],
		name: "Wingman Devstral Small",
		limits: { maxInputTokens: 128000, maxOutputTokens: 128000 },
		capabilities: { toolCalling: true },
	},

	// GLM models
	{
		id: ["glm-5.1"],
		name: "Wingman GLM 5.1",
		limits: { maxInputTokens: 200000, maxOutputTokens: 131072 },
		capabilities: { toolCalling: true },
	},
	{
		id: ["glm-5"],
		name: "Wingman GLM 5",
		limits: { maxInputTokens: 204800, maxOutputTokens: 131072 },
		capabilities: { toolCalling: true },
	},
	{
		id: ["glm-4.7"],
		name: "Wingman GLM 4.7",
		limits: { maxInputTokens: 204800, maxOutputTokens: 131072 },
		capabilities: { toolCalling: true },
	},
	{
		id: ["glm-4.7-flash"],
		name: "Wingman GLM 4.7 Flash",
		limits: { maxInputTokens: 200000, maxOutputTokens: 131072 },
		capabilities: { toolCalling: true },
	},

	// Qwen models
	{
		id: ["qwen3.7-max"],
		name: "Wingman Qwen 3.7 Max",
		limits: { maxInputTokens: 1000000, maxOutputTokens: 65536 },
		capabilities: { toolCalling: true },
	},
	{
		id: ["qwen3.6-plus", "qwen3.6"],
		name: "Wingman Qwen 3.6",
		limits: { maxInputTokens: 1000000, maxOutputTokens: 65536 },
		capabilities: { toolCalling: true },
	},
	{
		id: ["qwen3.6-flash"],
		name: "Wingman Qwen 3.6 Flash",
		limits: { maxInputTokens: 1000000, maxOutputTokens: 65536 },
		capabilities: { toolCalling: true },
	},
	{
		id: ["qwen3.5-plus", "qwen3.5"],
		name: "Wingman Qwen 3.5",
		limits: { maxInputTokens: 983616, maxOutputTokens: 65536 },
		capabilities: { toolCalling: true },
	},
	{
		id: ["qwen3-next", "qwen3"],
		name: "Wingman Qwen 3",
		limits: { maxInputTokens: 126976, maxOutputTokens: 32768 },
		capabilities: { toolCalling: true },
	},
	{
		id: ["qwen3-coder-plus", "qwen3-coder-flash", "qwen3-coder-next", "qwen3-coder"],
		name: "Wingman Qwen 3 Coder",
		limits: { maxInputTokens: 1048576, maxOutputTokens: 65536 },
		capabilities: { toolCalling: true },
	},
];

export function toAvailableModelInfos(availableModelIds: Iterable<string>): ModelInfo[] {
	const available = availableModelIds instanceof Set ? availableModelIds : new Set(availableModelIds);

	return candidates.flatMap(candidate => {
		const modelId = candidate.id.find(id => available.has(id));
		return modelId ? [toModelInfo(candidate, modelId)] : [];
	});
}

export function resolveReasoningEffort(modelId: string, configuration?: Record<string, unknown>): ReasoningEffort | undefined {
	const supportedEfforts = candidates.find(candidate => candidate.id.includes(modelId))?.reasoningEffort ?? [];
	const rawEffort = configuration?.reasoningEffort;

	const requestedEffort = typeof rawEffort === "string" && (supportedEfforts as string[]).includes(rawEffort)
		? (rawEffort as ReasoningEffort)
		: undefined;

	if (requestedEffort === "none") {
		return undefined;
	}

	return requestedEffort ?? (supportedEfforts.includes("medium") ? "medium" : undefined);
}

function toModelInfo(candidate: ModelCandidate, modelId: string): ModelInfo {
	const info: ModelInfo = {
		id: `${providerModelPrefix}${modelId}`,
		name: candidate.name,
		family: modelId,
		version: "",
		maxInputTokens: candidate.limits.maxInputTokens,
		maxOutputTokens: candidate.limits.maxOutputTokens,
		capabilities: {
			imageInput: candidate.capabilities?.imageInput ?? false,
			toolCalling: candidate.capabilities?.toolCalling ?? false,
		},
	};

	if (candidate.reasoningEffort?.length) {
		(info as unknown as Record<string, unknown>).configurationSchema =
			buildReasoningConfigurationSchema(candidate.reasoningEffort);
	}

	return info;
}

/**
 * Shape matches the proposed `LanguageModelConfigurationSchema` from
 * `vscode.proposed.chatProvider.d.ts`. We attach it via a cast so this works
 * on stable `@types/vscode` and is picked up on hosts that support the
 * `chatProvider` proposed API.
 */
function buildReasoningConfigurationSchema(levels: ReasoningEffort[]): Record<string, unknown> {
	const defaultEffort: ReasoningEffort | undefined = levels.includes("medium") ? "medium" : undefined;

	return {
		properties: {
			reasoningEffort: {
				type: "string",
				title: "Thinking Effort",
				enum: levels,
				enumItemLabels: levels.map(level => {
					const value = String(level ?? "");
					return value.charAt(0).toUpperCase() + value.slice(1);
				}),
				enumDescriptions: levels.map(describeReasoningEffort),
				...(defaultEffort && { default: defaultEffort }),
				group: "navigation",
			},
		},
	};
}

function describeReasoningEffort(level: ReasoningEffort): string {
	switch (level) {
		case "none": return "No reasoning applied";
		case "low": return "Faster responses with less reasoning";
		case "medium": return "Balanced reasoning and speed";
		case "high": return "Greater reasoning depth but slower";
		case "xhigh": return "Maximum reasoning depth but slower";
		default: return level ?? "";
	}
}
