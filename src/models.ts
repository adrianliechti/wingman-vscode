/**
 * Reasoning effort levels forwarded verbatim by the built-in "Custom
 * Endpoint" provider. GPT-5.1+ models accept "none" (which replaced
 * "minimal") to disable reasoning; the Wingman gateway maps "none" to
 * thinking-off for Anthropic/Google upstreams.
 */
type ReasoningEffort = "none" | "low" | "medium" | "high" | "xhigh";

/**
 * Model entry of the built-in `customendpoint` language model provider
 * shipped with VS Code's bundled Copilot Chat extension.
 */
export interface CustomEndpointModel {
	id: string;
	name: string;
	url: string;
	toolCalling: boolean;
	vision: boolean;
	maxInputTokens: number;
	maxOutputTokens: number;
	thinking?: boolean;
	zeroDataRetentionEnabled?: boolean;
	supportsReasoningEffort?: ReasoningEffort[];
}

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

	/**
	 * Whether the model emits thinking/reasoning output. Implied by
	 * `reasoningEffort`; set explicitly for models that reason without
	 * accepting an effort parameter.
	 */
	thinking?: boolean;
}

interface ModelCandidate {
	id: string[];
	name: string;
	limits: ModelLimits;
	capabilities?: ModelCapabilities;

	/**
	 * Reasoning effort levels this model accepts. When present, the built-in
	 * provider renders a "Thinking Effort" picker and forwards the chosen
	 * value as `reasoning.effort` (Responses API).
	 */
	reasoningEffort?: ReasoningEffort[];
}

const candidates: ModelCandidate[] = [
	// OpenAI models
	{
		id: ["gpt-5.5"],
		name: "GPT 5.5",
		limits: { maxInputTokens: 922000, maxOutputTokens: 128000 },
		capabilities: { toolCalling: true, imageInput: true },
		reasoningEffort: ["none", "low", "medium", "high", "xhigh"],
	},
	{
		id: ["gpt-5.4"],
		name: "GPT 5.4",
		limits: { maxInputTokens: 922000, maxOutputTokens: 128000 },
		capabilities: { toolCalling: true, imageInput: true },
		reasoningEffort: ["none", "low", "medium", "high", "xhigh"],
	},
	{
		id: ["gpt-5.4-mini"],
		name: "GPT 5.4 mini",
		limits: { maxInputTokens: 272000, maxOutputTokens: 128000 },
		capabilities: { toolCalling: true, imageInput: true },
		reasoningEffort: ["none", "low", "medium", "high", "xhigh"],
	},
	{
		id: ["gpt-5.2"],
		name: "GPT 5.2",
		limits: { maxInputTokens: 272000, maxOutputTokens: 128000 },
		capabilities: { toolCalling: true, imageInput: true },
		reasoningEffort: ["none", "low", "medium", "high", "xhigh"],
	},
	{
		id: ["gpt-5.1"],
		name: "GPT 5.1",
		limits: { maxInputTokens: 272000, maxOutputTokens: 128000 },
		capabilities: { toolCalling: true, imageInput: true },
		reasoningEffort: ["none", "low", "medium", "high"],
	},

	{
		id: ["gpt-5.3-codex"],
		name: "Codex 5.3",
		limits: { maxInputTokens: 272000, maxOutputTokens: 128000 },
		capabilities: { toolCalling: true, imageInput: true },
		reasoningEffort: ["low", "medium", "high", "xhigh"],
	},
	{
		id: ["gpt-5.2-codex"],
		name: "Codex 5.2",
		limits: { maxInputTokens: 272000, maxOutputTokens: 128000 },
		capabilities: { toolCalling: true, imageInput: true },
		reasoningEffort: ["low", "medium", "high", "xhigh"],
	},

	// Gemini models
	{
		id: ["gemini-3.5-flash"],
		name: "Gemini 3.5 Flash",
		limits: { maxInputTokens: 1048576, maxOutputTokens: 65536 },
		capabilities: { toolCalling: true, imageInput: true, thinking: true },
	},
	{
		id: ["gemini-3.1-pro", "gemini-3.1-pro-preview"],
		name: "Gemini 3.1 Pro",
		limits: { maxInputTokens: 1048576, maxOutputTokens: 65536 },
		capabilities: { toolCalling: true, imageInput: true, thinking: true },
	},
	{
		id: ["gemini-3-pro", "gemini-3-pro-preview"],
		name: "Gemini 3 Pro",
		limits: { maxInputTokens: 1048576, maxOutputTokens: 65536 },
		capabilities: { toolCalling: true, imageInput: true, thinking: true },
	},
	{
		id: ["gemini-3-flash", "gemini-3-flash-preview"],
		name: "Gemini 3 Flash",
		limits: { maxInputTokens: 1048576, maxOutputTokens: 65536 },
		capabilities: { toolCalling: true, imageInput: true, thinking: true },
	},

	// Claude models
	{
		id: ["claude-opus-4-8"],
		name: "Opus 4.8",
		limits: { maxInputTokens: 1000000, maxOutputTokens: 128000 },
		capabilities: { toolCalling: true, imageInput: true },
		reasoningEffort: ["none", "low", "medium", "high", "xhigh"],
	},
	{
		id: ["claude-opus-4-7"],
		name: "Opus 4.7",
		limits: { maxInputTokens: 1000000, maxOutputTokens: 128000 },
		capabilities: { toolCalling: true, imageInput: true },
		reasoningEffort: ["none", "low", "medium", "high", "xhigh"],
	},
	{
		id: ["claude-opus-4-6"],
		name: "Opus 4.6",
		limits: { maxInputTokens: 1000000, maxOutputTokens: 128000 },
		capabilities: { toolCalling: true, imageInput: true },
		reasoningEffort: ["none", "low", "medium", "high"],
	},
	{
		id: ["claude-opus-4-5"],
		name: "Opus 4.5",
		limits: { maxInputTokens: 200000, maxOutputTokens: 64000 },
		capabilities: { toolCalling: true, imageInput: true },
		reasoningEffort: ["none", "low", "medium", "high"],
	},

	{
		id: ["claude-sonnet-4-6"],
		name: "Sonnet 4.6",
		limits: { maxInputTokens: 1000000, maxOutputTokens: 64000 },
		capabilities: { toolCalling: true, imageInput: true },
		reasoningEffort: ["none", "low", "medium", "high"],
	},
	{
		id: ["claude-sonnet-4-5"],
		name: "Sonnet 4.5",
		limits: { maxInputTokens: 200000, maxOutputTokens: 64000 },
		capabilities: { toolCalling: true, imageInput: true },
		reasoningEffort: ["none", "low", "medium", "high"],
	},

	{
		id: ["claude-haiku-4-6"],
		name: "Haiku 4.6",
		limits: { maxInputTokens: 200000, maxOutputTokens: 64000 },
		capabilities: { toolCalling: true, imageInput: true },
	},
	{
		id: ["claude-haiku-4-5"],
		name: "Haiku 4.5",
		limits: { maxInputTokens: 200000, maxOutputTokens: 64000 },
		capabilities: { toolCalling: true, imageInput: true },
	},

	// Devstral models
	{
		id: ["devstral-medium", "devstral-medium-latest", "devstral-latest", "devstral"],
		name: "Devstral Medium",
		limits: { maxInputTokens: 262144, maxOutputTokens: 262144 },
		capabilities: { toolCalling: true },
	},
	{
		id: ["devstral-small", "devstral-small-latest"],
		name: "Devstral Small",
		limits: { maxInputTokens: 128000, maxOutputTokens: 128000 },
		capabilities: { toolCalling: true },
	},

	// GLM models
	{
		id: ["glm-5.1"],
		name: "GLM 5.1",
		limits: { maxInputTokens: 200000, maxOutputTokens: 131072 },
		capabilities: { toolCalling: true },
	},
	{
		id: ["glm-5"],
		name: "GLM 5",
		limits: { maxInputTokens: 204800, maxOutputTokens: 131072 },
		capabilities: { toolCalling: true },
	},
	{
		id: ["glm-4.7"],
		name: "GLM 4.7",
		limits: { maxInputTokens: 204800, maxOutputTokens: 131072 },
		capabilities: { toolCalling: true },
	},
	{
		id: ["glm-4.7-flash"],
		name: "GLM 4.7 Flash",
		limits: { maxInputTokens: 200000, maxOutputTokens: 131072 },
		capabilities: { toolCalling: true },
	},

	// Qwen models
	{
		id: ["qwen3.7-max"],
		name: "Qwen 3.7 Max",
		limits: { maxInputTokens: 1000000, maxOutputTokens: 65536 },
		capabilities: { toolCalling: true },
	},
	{
		id: ["qwen3.6-plus", "qwen3.6"],
		name: "Qwen 3.6",
		limits: { maxInputTokens: 1000000, maxOutputTokens: 65536 },
		capabilities: { toolCalling: true },
	},
	{
		id: ["qwen3.6-flash"],
		name: "Qwen 3.6 Flash",
		limits: { maxInputTokens: 1000000, maxOutputTokens: 65536 },
		capabilities: { toolCalling: true },
	},
	{
		id: ["qwen3.5-plus", "qwen3.5"],
		name: "Qwen 3.5",
		limits: { maxInputTokens: 983616, maxOutputTokens: 65536 },
		capabilities: { toolCalling: true },
	},
	{
		id: ["qwen3-next", "qwen3"],
		name: "Qwen 3",
		limits: { maxInputTokens: 126976, maxOutputTokens: 32768 },
		capabilities: { toolCalling: true },
	},
	{
		id: ["qwen3-coder-plus", "qwen3-coder-flash", "qwen3-coder-next", "qwen3-coder"],
		name: "Qwen 3 Coder",
		limits: { maxInputTokens: 1048576, maxOutputTokens: 65536 },
		capabilities: { toolCalling: true },
	},
];

export function toCustomEndpointModels(availableModelIds: Iterable<string>, url: string): CustomEndpointModel[] {
	const available = new Set(availableModelIds);

	return candidates.flatMap(candidate => {
		const modelId = candidate.id.find(id => available.has(id));
		return modelId ? [toModel(candidate, modelId, url)] : [];
	});
}

function toModel(candidate: ModelCandidate, modelId: string, url: string): CustomEndpointModel {
	const model: CustomEndpointModel = {
		id: modelId,
		name: candidate.name,
		url,
		toolCalling: candidate.capabilities?.toolCalling ?? false,
		vision: candidate.capabilities?.imageInput ?? false,
		maxInputTokens: candidate.limits.maxInputTokens,
		maxOutputTokens: candidate.limits.maxOutputTokens,
		thinking: candidate.capabilities?.thinking ?? !!candidate.reasoningEffort?.length,
		zeroDataRetentionEnabled: true,
	};

	if (candidate.reasoningEffort?.length) {
		model.supportsReasoningEffort = candidate.reasoningEffort;
	}

	return model;
}
