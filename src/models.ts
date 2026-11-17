/**
 * Reasoning effort levels offered in the "Thinking Effort" picker.
 *
 * Responses API models: forwarded verbatim as `reasoning.effort`. "none"
 * disables reasoning where supported. GPT-6.2 Astra and Sol, GPT-6 Astra,
 * and GPT-6.1 Sol require at least "low". GPT-5.6+ add "max" above
 * "xhigh" for the hardest quality-first workloads.
 *
 * Messages API models: forwarded verbatim as `output_config.effort`; Anthropic
 * accepts "low" | "medium" | "high" and, on selected models, "xhigh" and
 * "max". Disabling thinking is a separate `thinking.type` control, not an
 * effort level.
 *
 * Chat Completions models: forwarded as `reasoning_effort`. Wingman maps
 * Gemini efforts to thinking levels; GLM 5.3 accepts "low", "high", "max".
 */
type ReasoningEffort = "none" | "low" | "medium" | "high" | "xhigh" | "max";

/**
 * Wire protocol the built-in provider speaks for a model. Overrides the
 * group-level `apiType`. The `messages` type is the native Anthropic
 * Messages API and enables prompt-cache breakpoints and thinking-block
 * round-tripping.
 */
type ApiType = "responses" | "messages" | "chat-completions";

/**
 * Endpoint path per wire protocol. The model `url` carries the full path:
 * the built-in provider inserts `/v1` into base URLs without a version
 * segment, which would diverge from the `/models` URL the backend is
 * queried with.
 */
const apiPaths: Record<ApiType, string> = {
	"responses": "/responses",
	"messages": "/messages",
	"chat-completions": "/chat/completions",
};

/**
 * Model entry of the built-in `customendpoint` language model provider
 * shipped with VS Code's bundled Copilot Chat extension.
 */
export type CustomEndpointModel = ModelLimits & {
	id: string;
	name: string;
	url: string;
	apiType: ApiType;
	toolCalling: boolean;
	vision: boolean;
	thinking?: boolean;
	adaptiveThinking?: boolean;
	zeroDataRetentionEnabled?: boolean;
	requestHeaders: Record<string, string>;
	supportsReasoningEffort?: ReasoningEffort[];
};

/**
 * Shared context windows and output budgets. These follow published limits
 * unless a smaller integration budget is explicitly documented below.
 *
 * {@link toModel} forwards them verbatim: the built-in provider treats
 * `contextWindow` as the source of truth and derives the output-reserved
 * input budget as `contextWindow - maxOutputTokens`.
 */
type ModelLimits = { contextWindow: number; maxOutputTokens: number };

interface ModelCapabilities {
	toolCalling?: boolean;
	imageInput?: boolean;

	/**
	 * Whether the model emits thinking/reasoning output. Implied by
	 * `reasoningEffort`; set explicitly for models that reason without
	 * accepting an effort parameter.
	 */
	thinking?: boolean;

	/**
	 * Whether a Messages API model supports adaptive thinking. The built-in
	 * provider sends an adaptive `thinking` config when the caller also enables
	 * thinking. Otherwise the field is omitted, preserving the backend model's
	 * default (adaptive thinking is on by default for Claude 5.x).
	 */
	adaptiveThinking?: boolean;
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
	 * value as `reasoning.effort` (Responses API) or `output_config.effort`
	 * (Messages API) or `reasoning_effort` (Chat Completions). An omitted
	 * thinking config preserves the model's default.
	 */
	reasoningEffort?: ReasoningEffort[];
}

// The first available model in each class is preferred for utility tasks.
const candidates: ModelCandidate[] = [
	// OpenAI models
	{
		id: ["gpt-6.2-astra"],
		name: "GPT 6.2 Astra",
		class: "large",
		apiType: "responses",
		limits: { contextWindow: 1050000, maxOutputTokens: 128000 },
		capabilities: { toolCalling: true, imageInput: true },
		reasoningEffort: ["low", "medium", "high", "xhigh", "max"],
	},
	{
		id: ["gpt-6.2-sol"],
		name: "GPT 6.2 Sol",
		class: "large",
		apiType: "responses",
		limits: { contextWindow: 1050000, maxOutputTokens: 128000 },
		capabilities: { toolCalling: true, imageInput: true },
		reasoningEffort: ["low", "medium", "high", "xhigh", "max"],
	},
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
		id: ["gpt-6.1-sol"],
		name: "GPT 6.1 Sol",
		class: "large",
		apiType: "responses",
		limits: { contextWindow: 1050000, maxOutputTokens: 128000 },
		capabilities: { toolCalling: true, imageInput: true },
		reasoningEffort: ["low", "medium", "high", "xhigh", "max"],
	},
	{
		id: ["gpt-6.1-terra"],
		name: "GPT 6.1 Terra",
		class: "medium",
		apiType: "responses",
		limits: { contextWindow: 1050000, maxOutputTokens: 128000 },
		capabilities: { toolCalling: true, imageInput: true },
		reasoningEffort: ["none", "low", "medium", "high", "xhigh", "max"],
	},
	{
		id: ["gpt-6-sol"],
		name: "GPT 6 Sol",
		class: "large",
		apiType: "responses",
		limits: { contextWindow: 1050000, maxOutputTokens: 128000 },
		capabilities: { toolCalling: true, imageInput: true },
		reasoningEffort: ["none", "low", "medium", "high", "xhigh", "max"],
	},
	{
		id: ["gpt-6-luna"],
		name: "GPT 6 Luna",
		class: "small",
		apiType: "responses",
		limits: { contextWindow: 1050000, maxOutputTokens: 128000 },
		capabilities: { toolCalling: true, imageInput: true },
		reasoningEffort: ["none", "low", "medium", "high", "xhigh", "max"],
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

	// Gemini models
	// https://aistudio.google.com/docs/models
	// Shared input/output windows with the synchronous output limit; long
	// decode requires a separate API mode and is not used by this integration.
	{
		id: ["gemini-4-carbon"],
		name: "Gemini 4 Carbon",
		class: "large",
		limits: { contextWindow: 1048576, maxOutputTokens: 65536 },
		capabilities: { toolCalling: true, imageInput: true },
		reasoningEffort: ["low", "medium", "high"],
	},
	{
		id: ["gemini-4-argon"],
		name: "Gemini 4 Argon",
		class: "medium",
		limits: { contextWindow: 1048576, maxOutputTokens: 65536 },
		capabilities: { toolCalling: true, imageInput: true },
		reasoningEffort: ["low", "medium", "high"],
	},
	{
		id: ["gemini-4-hydrogen"],
		name: "Gemini 4 Hydrogen",
		class: "small",
		limits: { contextWindow: 1048576, maxOutputTokens: 65536 },
		capabilities: { toolCalling: true, imageInput: true },
		reasoningEffort: ["low", "medium", "high", "xhigh"],
	},

	// Claude models
	{
		id: ["claude-fable-5-2"],
		name: "Fable 5.2",
		class: "large",
		apiType: "messages",
		limits: { contextWindow: 1000000, maxOutputTokens: 128000 },
		capabilities: { toolCalling: true, imageInput: true, adaptiveThinking: true },
		reasoningEffort: ["low", "medium", "high", "xhigh", "max"],
	},
	{
		id: ["claude-opus-5-5"],
		name: "Opus 5.5",
		class: "large",
		apiType: "messages",
		limits: { contextWindow: 1000000, maxOutputTokens: 128000 },
		capabilities: { toolCalling: true, imageInput: true, adaptiveThinking: true },
		reasoningEffort: ["low", "medium", "high", "xhigh", "max"],
	},

	{
		id: ["claude-sonnet-5-5"],
		name: "Sonnet 5.5",
		class: "medium",
		apiType: "messages",
		limits: { contextWindow: 1000000, maxOutputTokens: 128000 },
		capabilities: { toolCalling: true, imageInput: true, adaptiveThinking: true },
		reasoningEffort: ["low", "medium", "high", "xhigh", "max"],
	},

	{
		id: ["claude-haiku-5-5"],
		name: "Haiku 5.5",
		class: "small",
		apiType: "messages",
		limits: { contextWindow: 1000000, maxOutputTokens: 128000 },
		capabilities: { toolCalling: true, imageInput: true, adaptiveThinking: true },
		reasoningEffort: ["low", "medium", "high", "xhigh", "max"],
	},

	// GLM models
	// https://docs.z.ai/guides/llm/glm-5.3
	// https://docs.z.ai/guides/vlm/glm-5.3-flash
	{
		id: ["glm-5.3"],
		name: "GLM 5.3",
		class: "medium",
		limits: { contextWindow: 1048576, maxOutputTokens: 131072 },
		capabilities: { toolCalling: true },
		reasoningEffort: ["low", "high", "max"],
	},
	{
		id: ["glm-5.3-flash"],
		name: "GLM 5.3 Flash",
		class: "small",
		limits: { contextWindow: 1048576, maxOutputTokens: 131072 },
		capabilities: { toolCalling: true, imageInput: true },
		reasoningEffort: ["low", "high", "max"],
	},

	// Qwen models
	// Curated Qwen 3.8 choices; snapshots and provider-qualified IDs are
	// aliases, not additional picker entries. https://openrouter.ai/qwen
	{
		id: ["qwen3.8-max", "qwen3.8-max-0902", "qwen3.8-max-2026-09-02", "qwen/qwen3.8-max-0902"],
		name: "Qwen 3.8 Max",
		class: "large",
		limits: { contextWindow: 1000000, maxOutputTokens: 131072 },
		capabilities: { toolCalling: true, imageInput: true },
		reasoningEffort: ["low", "medium", "xhigh"],
	},
	{
		id: ["qwen3.8-flash", "qwen/qwen3.8-flash"],
		name: "Qwen 3.8 Flash",
		class: "small",
		limits: { contextWindow: 1000000, maxOutputTokens: 131072 },
		// OpenRouter advertises reasoning but no discrete effort levels for Flash.
		capabilities: { toolCalling: true, imageInput: true, thinking: true },
	},
	{
		id: ["qwen3.8-27b", "Qwen/Qwen3.8-27B", "qwen/qwen3.8-27b"],
		name: "Qwen 3.8 27B",
		class: "small",
		// Use the native window for local deployments; 1M needs YaRN scaling.
		// https://huggingface.co/Qwen/Qwen3.8-27B
		limits: { contextWindow: 262144, maxOutputTokens: 131072 },
		capabilities: { toolCalling: true, imageInput: true },
		reasoningEffort: ["low", "medium", "xhigh"],
	},

	// Thinking Machines models
	{
		id: ["inkling-2-small", "thinkingmachines/Inkling-2-Small", "thinkingmachines/inkling-2-small"],
		name: "Inkling 2 Small",
		class: "small",
		// The model can decode across its shared 1M window. Reserve 128K for
		// output here so Copilot retains most of the window for project context.
		// https://huggingface.co/thinkingmachines/Inkling-2-Small
		limits: { contextWindow: 1048576, maxOutputTokens: 131072 },
		capabilities: { toolCalling: true, imageInput: true },
		reasoningEffort: ["low", "medium", "high", "max"],
	},

	// Mistral models
	// https://docs.mistral.ai/inference/conversations/reasoning
	{
		id: ["mistral-large-4", "mistral-large-4-0", "mistralai/mistral-large-4-0"],
		name: "Mistral Large 4",
		class: "large",
		limits: { contextWindow: 1048576, maxOutputTokens: 262144 },
		capabilities: { toolCalling: true, imageInput: true },
		// Current GA levels replace the preview's none/high naming.
		reasoningEffort: ["low", "medium", "high"],
	},
	{
		id: ["mistral-small-4", "mistral-small-2603", "mistralai/mistral-small-2603"],
		name: "Mistral Small 4",
		class: "small",
		// Reserve 64K for output so most of the shared window remains usable
		// for project context; this is an integration budget, not a model limit.
		limits: { contextWindow: 262144, maxOutputTokens: 65536 },
		capabilities: { toolCalling: true, imageInput: true },
		reasoningEffort: ["none", "high"],
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

export function toCustomEndpointModels(availableModelIds: Iterable<string>, baseUrl: string): CustomEndpointModels {
	const available = new Set(availableModelIds);
	const known = new Set(candidates.flatMap(candidate => candidate.id));

	return {
		models: availableCandidates(available).map(({ candidate, id }) => toModel(candidate, id, baseUrl)),
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

function toModel(candidate: ModelCandidate, modelId: string, baseUrl: string): CustomEndpointModel {
	const apiType = candidate.apiType ?? "chat-completions";

	const model: CustomEndpointModel = {
		id: modelId,
		name: candidate.name,
		url: baseUrl + apiPaths[apiType],
		apiType,
		toolCalling: candidate.capabilities?.toolCalling ?? false,
		vision: candidate.capabilities?.imageInput ?? false,
		...candidate.limits,
		thinking: candidate.capabilities?.thinking ?? (!!candidate.capabilities?.adaptiveThinking || !!candidate.reasoningEffort?.length),
		zeroDataRetentionEnabled: true,
		// Wingman's authentication expects Bearer credentials for every API,
		// including Messages. Let VS Code interpolate its stored secret; never
		// write the API key itself into the model configuration.
		requestHeaders: { Authorization: 'Bearer ${apiKey}' },
	};

	if (candidate.capabilities?.adaptiveThinking) {
		model.adaptiveThinking = true;
	}

	if (candidate.reasoningEffort?.length) {
		model.supportsReasoningEffort = candidate.reasoningEffort;
	}

	return model;
}
