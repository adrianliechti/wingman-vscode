/**
 * Reasoning effort levels offered in the "Thinking Effort" picker.
 *
 * Responses API models: forwarded verbatim as `reasoning.effort`; GPT-5.1+
 * accept "none" (which replaced "minimal") to disable reasoning — except the
 * reasoning-only GPT-5.5 and GPT-6 Astra — and GPT-5.6+ add "max" above
 * "xhigh" for the hardest quality-first workloads.
 *
 * Messages API models: forwarded verbatim as `output_config.effort`; Anthropic
 * accepts "low" | "medium" | "high" and, on selected models, "xhigh" and
 * "max". Disabling thinking is a separate `thinking.type` control, not an
 * effort level.
 */
type ReasoningEffort = "none" | "low" | "medium" | "high" | "xhigh" | "max";

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

/**
 * Token limits as the vendor documents them (cross-checked against
 * https://models.dev). Vendors that advertise a total context window shared
 * by input and output (OpenAI, Anthropic, GLM, Qwen) declare
 * `contextWindow`. Vendors that document an input-only limit (Gemini)
 * declare `maxInputTokens` verbatim.
 *
 * The built-in provider uses `maxInputTokens` verbatim as the prompt budget
 * and displays `maxInputTokens + maxOutputTokens` as the context window (see
 * `resolveModelTokenLimits` in the bundled Copilot extension), so
 * {@link toModel} derives the output-reserved input budget from
 * `contextWindow` entries as `contextWindow - maxOutputTokens`.
 */
type ModelLimits =
	| { contextWindow: number; maxInputTokens?: never; maxOutputTokens: number }
	| { contextWindow?: never; maxInputTokens: number; maxOutputTokens: number };

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
	class: "large" | "medium" | "small";
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

// The first available model in each class is preferred for utility tasks.
const candidates: ModelCandidate[] = [
	// OpenAI models
	{
		id: ["gpt-6-astra"],
		name: "GPT 6 Astra",
		class: "large",
		apiType: "responses",
		limits: { contextWindow: 1050000, maxOutputTokens: 128000 },
		capabilities: { toolCalling: true, imageInput: true },
		reasoningEffort: ["low", "medium", "high", "xhigh", "max"],
	},
	{
		id: ["gpt-5.6-sol", "gpt-5.6"],
		name: "GPT 5.6 Sol",
		class: "large",
		apiType: "responses",
		limits: { contextWindow: 1050000, maxOutputTokens: 128000 },
		capabilities: { toolCalling: true, imageInput: true },
		reasoningEffort: ["none", "low", "medium", "high", "xhigh", "max"],
	},
	{
		id: ["gpt-5.6-luna"],
		name: "GPT 5.6 Luna",
		class: "small",
		apiType: "responses",
		limits: { contextWindow: 1050000, maxOutputTokens: 128000 },
		capabilities: { toolCalling: true, imageInput: true },
		reasoningEffort: ["none", "low", "medium", "high", "xhigh", "max"],
	},
	{
		id: ["gpt-5.6-terra"],
		name: "GPT 5.6 Terra",
		class: "medium",
		apiType: "responses",
		limits: { contextWindow: 1050000, maxOutputTokens: 128000 },
		capabilities: { toolCalling: true, imageInput: true },
		reasoningEffort: ["none", "low", "medium", "high", "xhigh", "max"],
	},
	{
		id: ["gpt-5.5"],
		name: "GPT 5.5",
		class: "medium",
		apiType: "responses",
		limits: { contextWindow: 1050000, maxOutputTokens: 128000 },
		capabilities: { toolCalling: true, imageInput: true },
		reasoningEffort: ["low", "medium", "high", "xhigh"],
	},
	{
		id: ["gpt-5.4"],
		name: "GPT 5.4",
		class: "medium",
		apiType: "responses",
		limits: { contextWindow: 1050000, maxOutputTokens: 128000 },
		capabilities: { toolCalling: true, imageInput: true },
		reasoningEffort: ["none", "low", "medium", "high", "xhigh"],
	},
	{
		id: ["gpt-5.4-mini"],
		name: "GPT 5.4 mini",
		class: "small",
		apiType: "responses",
		limits: { contextWindow: 400000, maxOutputTokens: 128000 },
		capabilities: { toolCalling: true, imageInput: true },
		reasoningEffort: ["none", "low", "medium", "high", "xhigh"],
	},
	{
		id: ["gpt-5.2"],
		name: "GPT 5.2",
		class: "medium",
		apiType: "responses",
		limits: { contextWindow: 400000, maxOutputTokens: 128000 },
		capabilities: { toolCalling: true, imageInput: true },
		reasoningEffort: ["none", "low", "medium", "high", "xhigh"],
	},
	{
		id: ["gpt-5.1"],
		name: "GPT 5.1",
		class: "medium",
		apiType: "responses",
		limits: { contextWindow: 400000, maxOutputTokens: 128000 },
		capabilities: { toolCalling: true, imageInput: true },
		reasoningEffort: ["none", "low", "medium", "high"],
	},

	{
		id: ["gpt-5.3-codex"],
		name: "Codex 5.3",
		class: "medium",
		apiType: "responses",
		limits: { contextWindow: 400000, maxOutputTokens: 128000 },
		capabilities: { toolCalling: true, imageInput: true },
		reasoningEffort: ["low", "medium", "high", "xhigh"],
	},
	{
		id: ["gpt-5.2-codex"],
		name: "Codex 5.2",
		class: "medium",
		apiType: "responses",
		limits: { contextWindow: 400000, maxOutputTokens: 128000 },
		capabilities: { toolCalling: true, imageInput: true },
		reasoningEffort: ["low", "medium", "high", "xhigh"],
	},

	// Gemini models
	{
		id: ["gemini-3.5-flash"],
		name: "Gemini 3.5 Flash",
		class: "medium",
		limits: { maxInputTokens: 1048576, maxOutputTokens: 65536 },
		capabilities: { toolCalling: true, imageInput: true, thinking: true },
	},
	{
		id: ["gemini-3.1-pro", "gemini-3.1-pro-preview"],
		name: "Gemini 3.1 Pro",
		class: "large",
		limits: { maxInputTokens: 1048576, maxOutputTokens: 65536 },
		capabilities: { toolCalling: true, imageInput: true, thinking: true },
	},
	{
		id: ["gemini-3-pro", "gemini-3-pro-preview"],
		name: "Gemini 3 Pro",
		class: "large",
		limits: { maxInputTokens: 1048576, maxOutputTokens: 65536 },
		capabilities: { toolCalling: true, imageInput: true, thinking: true },
	},
	{
		id: ["gemini-3-flash", "gemini-3-flash-preview"],
		name: "Gemini 3 Flash",
		class: "small",
		limits: { maxInputTokens: 1048576, maxOutputTokens: 65536 },
		capabilities: { toolCalling: true, imageInput: true, thinking: true },
	},

	// Claude models
	{
		id: ["claude-fable-5-1"],
		name: "Fable 5.1",
		class: "large",
		apiType: "messages",
		limits: { contextWindow: 1000000, maxOutputTokens: 128000 },
		capabilities: { toolCalling: true, imageInput: true },
		reasoningEffort: ["low", "medium", "high", "xhigh", "max"],
	},
	{
		id: ["claude-opus-5"],
		name: "Opus 5",
		class: "large",
		apiType: "messages",
		limits: { contextWindow: 1000000, maxOutputTokens: 128000 },
		capabilities: { toolCalling: true, imageInput: true },
		reasoningEffort: ["low", "medium", "high", "xhigh", "max"],
	},
	{
		id: ["claude-opus-4-8"],
		name: "Opus 4.8",
		class: "large",
		apiType: "messages",
		limits: { contextWindow: 1000000, maxOutputTokens: 128000 },
		capabilities: { toolCalling: true, imageInput: true },
		reasoningEffort: ["low", "medium", "high", "xhigh", "max"],
	},
	{
		id: ["claude-opus-4-7"],
		name: "Opus 4.7",
		class: "large",
		apiType: "messages",
		limits: { contextWindow: 1000000, maxOutputTokens: 128000 },
		capabilities: { toolCalling: true, imageInput: true },
		reasoningEffort: ["low", "medium", "high", "xhigh", "max"],
	},
	{
		id: ["claude-opus-4-6"],
		name: "Opus 4.6",
		class: "large",
		apiType: "messages",
		limits: { contextWindow: 1000000, maxOutputTokens: 128000 },
		capabilities: { toolCalling: true, imageInput: true },
		reasoningEffort: ["low", "medium", "high", "max"],
	},
	{
		id: ["claude-opus-4-5"],
		name: "Opus 4.5",
		class: "large",
		apiType: "messages",
		limits: { contextWindow: 200000, maxOutputTokens: 64000 },
		capabilities: { toolCalling: true, imageInput: true },
		reasoningEffort: ["low", "medium", "high"],
	},

	{
		id: ["claude-sonnet-5"],
		name: "Sonnet 5",
		class: "medium",
		apiType: "messages",
		limits: { contextWindow: 1000000, maxOutputTokens: 128000 },
		capabilities: { toolCalling: true, imageInput: true },
		reasoningEffort: ["low", "medium", "high", "xhigh", "max"],
	},
	{
		id: ["claude-sonnet-4-6"],
		name: "Sonnet 4.6",
		class: "medium",
		apiType: "messages",
		limits: { contextWindow: 1000000, maxOutputTokens: 128000 },
		capabilities: { toolCalling: true, imageInput: true },
		reasoningEffort: ["low", "medium", "high", "max"],
	},
	{
		id: ["claude-sonnet-4-5"],
		name: "Sonnet 4.5",
		class: "medium",
		apiType: "messages",
		limits: { contextWindow: 200000, maxOutputTokens: 64000 },
		capabilities: { toolCalling: true, imageInput: true, thinking: true },
	},

	{
		id: ["claude-haiku-4-6"],
		name: "Haiku 4.6",
		class: "small",
		apiType: "messages",
		limits: { contextWindow: 200000, maxOutputTokens: 64000 },
		capabilities: { toolCalling: true, imageInput: true },
	},
	{
		id: ["claude-haiku-4-5"],
		name: "Haiku 4.5",
		class: "small",
		apiType: "messages",
		limits: { contextWindow: 200000, maxOutputTokens: 64000 },
		capabilities: { toolCalling: true, imageInput: true },
	},

	// Devstral models
	{
		id: ["devstral-medium", "devstral-medium-latest", "devstral-latest", "devstral"],
		name: "Devstral Medium",
		class: "medium",
		limits: { maxInputTokens: 262144, maxOutputTokens: 262144 },
		capabilities: { toolCalling: true },
	},
	{
		id: ["devstral-small", "devstral-small-latest"],
		name: "Devstral Small",
		class: "small",
		limits: { maxInputTokens: 128000, maxOutputTokens: 128000 },
		capabilities: { toolCalling: true },
	},

	// GLM models
	{
		id: ["glm-5.1"],
		name: "GLM 5.1",
		class: "medium",
		limits: { contextWindow: 200000, maxOutputTokens: 131072 },
		capabilities: { toolCalling: true },
	},
	{
		id: ["glm-5"],
		name: "GLM 5",
		class: "medium",
		limits: { contextWindow: 204800, maxOutputTokens: 131072 },
		capabilities: { toolCalling: true },
	},
	{
		id: ["glm-4.7"],
		name: "GLM 4.7",
		class: "medium",
		limits: { contextWindow: 204800, maxOutputTokens: 131072 },
		capabilities: { toolCalling: true },
	},
	{
		id: ["glm-4.7-flash"],
		name: "GLM 4.7 Flash",
		class: "small",
		limits: { contextWindow: 200000, maxOutputTokens: 131072 },
		capabilities: { toolCalling: true },
	},

	// Qwen models
	{
		id: ["qwen3.7-max"],
		name: "Qwen 3.7 Max",
		class: "large",
		limits: { contextWindow: 1000000, maxOutputTokens: 65536 },
		capabilities: { toolCalling: true },
	},
	{
		id: ["qwen3.6-plus", "qwen3.6"],
		name: "Qwen 3.6",
		class: "medium",
		limits: { contextWindow: 1000000, maxOutputTokens: 65536 },
		capabilities: { toolCalling: true },
	},
	{
		id: ["qwen3.6-flash"],
		name: "Qwen 3.6 Flash",
		class: "small",
		limits: { contextWindow: 1000000, maxOutputTokens: 65536 },
		capabilities: { toolCalling: true },
	},
	{
		id: ["qwen3.5-plus", "qwen3.5"],
		name: "Qwen 3.5",
		class: "medium",
		limits: { contextWindow: 1000000, maxOutputTokens: 65536 },
		capabilities: { toolCalling: true },
	},
	{
		id: ["qwen3-next", "qwen3"],
		name: "Qwen 3",
		class: "medium",
		limits: { maxInputTokens: 126976, maxOutputTokens: 32768 },
		capabilities: { toolCalling: true },
	},
	{
		id: ["qwen3-coder-plus", "qwen3-coder-flash", "qwen3-coder-next", "qwen3-coder"],
		name: "Qwen 3 Coder",
		class: "medium",
		limits: { contextWindow: 1048576, maxOutputTokens: 65536 },
		capabilities: { toolCalling: true },
	},
];

export interface CustomEndpointModels {
	models: CustomEndpointModel[];

	/** Backend model ids no candidate claims — surfaced so they don't vanish silently. */
	unmatched: string[];
}

/** Resolves each catalog entry to the first of its ids the backend offers, in catalog order. */
function availableCandidates(available: ReadonlySet<string>): { candidate: ModelCandidate; id: string }[] {
	return candidates.flatMap(candidate => {
		const id = candidate.id.find(id => available.has(id));
		return id ? [{ candidate, id }] : [];
	});
}

export function toCustomEndpointModels(availableModelIds: Iterable<string>, url: string): CustomEndpointModels {
	const available = new Set(availableModelIds);
	const known = new Set(candidates.flatMap(candidate => candidate.id));

	return {
		models: availableCandidates(available).map(({ candidate, id }) => toModel(candidate, id, url)),
		unmatched: [...available].filter(id => !known.has(id)),
	};
}

/** Selects utility defaults in catalog order, sharing a model when needed. */
export function selectUtilityModels(availableModelIds: Iterable<string>): { utilityModel: string; utilitySmallModel: string } | undefined {
	const models = availableCandidates(new Set(availableModelIds));

	const small = models.find(({ candidate }) => candidate.class === "small")?.id;
	const general = models.find(({ candidate }) => candidate.class === "medium")?.id ?? small ?? models[0]?.id;
	return general ? { utilityModel: general, utilitySmallModel: small ?? general } : undefined;
}

function toModel(candidate: ModelCandidate, modelId: string, url: string): CustomEndpointModel {
	const limits = candidate.limits;

	const model: CustomEndpointModel = {
		id: modelId,
		name: candidate.name,
		url,
		apiType: candidate.apiType ?? "chat-completions",
		toolCalling: candidate.capabilities?.toolCalling ?? false,
		vision: candidate.capabilities?.imageInput ?? false,
		maxInputTokens: limits.contextWindow !== undefined ? limits.contextWindow - limits.maxOutputTokens : limits.maxInputTokens,
		maxOutputTokens: limits.maxOutputTokens,
		thinking: candidate.capabilities?.thinking ?? !!candidate.reasoningEffort?.length,
		zeroDataRetentionEnabled: true,
	};

	if (candidate.reasoningEffort?.length) {
		model.supportsReasoningEffort = candidate.reasoningEffort;
	}

	return model;
}
