/**
 * Reasoning effort levels offered in the "Thinking Effort" picker.
 *
 * Responses API models: forwarded verbatim as `reasoning.effort`; GPT-5.1+
 * accept "none" (which replaced "minimal") to disable reasoning.
 *
 * Messages API models: the provider only forwards "low" | "medium" | "high"
 * as `output_config.effort`, and only once custom models can declare
 * adaptive thinking support — until then the picker is advisory.
 */
type ReasoningEffort = "none" | "low" | "medium" | "high" | "xhigh";

/**
 * Wire protocol the built-in provider speaks for a model. Overrides the
 * group-level `apiType`; the path suffix is appended to the model `url`
 * (`/responses`, `/messages`, `/chat/completions`). The `messages` type is
 * the native Anthropic Messages API and enables prompt-cache breakpoints
 * and thinking-block round-tripping.
 */
type ApiType = "responses" | "messages" | "chat-completions";

/**
 * Model entry of the built-in `customendpoint` language model provider
 * shipped with VS Code's bundled Copilot Chat extension.
 */
export interface CustomEndpointModel {
	id: string;
	name: string;
	url: string;
	apiType: ApiType;
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
	 * The provider uses this verbatim as the prompt budget and computes the
	 * context window as `maxInputTokens + maxOutputTokens`. Use the vendor's
	 * documented max *input* tokens — no subtraction needed when input is
	 * documented separately (Anthropic, Gemini). Vendors that only document
	 * a total context window (OpenAI: 400K window, 272K input) publish the
	 * output-reserved input limit themselves; use that number.
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
	 * Wire protocol for this model: `responses` for OpenAI, `messages` for
	 * Anthropic, `chat-completions` (default) for third-party models.
	 */
	apiType?: ApiType;

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
		apiType: "responses",
		limits: { maxInputTokens: 922000, maxOutputTokens: 128000 },
		capabilities: { toolCalling: true, imageInput: true },
		reasoningEffort: ["none", "low", "medium", "high", "xhigh"],
	},
	{
		id: ["gpt-5.4"],
		name: "GPT 5.4",
		apiType: "responses",
		limits: { maxInputTokens: 922000, maxOutputTokens: 128000 },
		capabilities: { toolCalling: true, imageInput: true },
		reasoningEffort: ["none", "low", "medium", "high", "xhigh"],
	},
	{
		id: ["gpt-5.4-mini"],
		name: "GPT 5.4 mini",
		apiType: "responses",
		limits: { maxInputTokens: 272000, maxOutputTokens: 128000 },
		capabilities: { toolCalling: true, imageInput: true },
		reasoningEffort: ["none", "low", "medium", "high", "xhigh"],
	},
	{
		id: ["gpt-5.2"],
		name: "GPT 5.2",
		apiType: "responses",
		limits: { maxInputTokens: 272000, maxOutputTokens: 128000 },
		capabilities: { toolCalling: true, imageInput: true },
		reasoningEffort: ["none", "low", "medium", "high", "xhigh"],
	},
	{
		id: ["gpt-5.1"],
		name: "GPT 5.1",
		apiType: "responses",
		limits: { maxInputTokens: 272000, maxOutputTokens: 128000 },
		capabilities: { toolCalling: true, imageInput: true },
		reasoningEffort: ["none", "low", "medium", "high"],
	},

	{
		id: ["gpt-5.3-codex"],
		name: "Codex 5.3",
		apiType: "responses",
		limits: { maxInputTokens: 272000, maxOutputTokens: 128000 },
		capabilities: { toolCalling: true, imageInput: true },
		reasoningEffort: ["low", "medium", "high", "xhigh"],
	},
	{
		id: ["gpt-5.2-codex"],
		name: "Codex 5.2",
		apiType: "responses",
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
		apiType: "messages",
		limits: { maxInputTokens: 1000000, maxOutputTokens: 128000 },
		capabilities: { toolCalling: true, imageInput: true },
		reasoningEffort: ["none", "low", "medium", "high", "xhigh"],
	},
	{
		id: ["claude-opus-4-7"],
		name: "Opus 4.7",
		apiType: "messages",
		limits: { maxInputTokens: 1000000, maxOutputTokens: 128000 },
		capabilities: { toolCalling: true, imageInput: true },
		reasoningEffort: ["none", "low", "medium", "high", "xhigh"],
	},
	{
		id: ["claude-opus-4-6"],
		name: "Opus 4.6",
		apiType: "messages",
		limits: { maxInputTokens: 1000000, maxOutputTokens: 128000 },
		capabilities: { toolCalling: true, imageInput: true },
		reasoningEffort: ["none", "low", "medium", "high"],
	},
	{
		id: ["claude-opus-4-5"],
		name: "Opus 4.5",
		apiType: "messages",
		limits: { maxInputTokens: 200000, maxOutputTokens: 64000 },
		capabilities: { toolCalling: true, imageInput: true },
		reasoningEffort: ["none", "low", "medium", "high"],
	},

	{
		id: ["claude-sonnet-4-6"],
		name: "Sonnet 4.6",
		apiType: "messages",
		limits: { maxInputTokens: 1000000, maxOutputTokens: 64000 },
		capabilities: { toolCalling: true, imageInput: true },
		reasoningEffort: ["none", "low", "medium", "high"],
	},
	{
		id: ["claude-sonnet-4-5"],
		name: "Sonnet 4.5",
		apiType: "messages",
		limits: { maxInputTokens: 200000, maxOutputTokens: 64000 },
		capabilities: { toolCalling: true, imageInput: true },
		reasoningEffort: ["none", "low", "medium", "high"],
	},

	{
		id: ["claude-haiku-4-6"],
		name: "Haiku 4.6",
		apiType: "messages",
		limits: { maxInputTokens: 200000, maxOutputTokens: 64000 },
		capabilities: { toolCalling: true, imageInput: true },
	},
	{
		id: ["claude-haiku-4-5"],
		name: "Haiku 4.5",
		apiType: "messages",
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
		apiType: candidate.apiType ?? "chat-completions",
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
