import type * as vscode from "vscode";

import type { ReasoningEffort } from "openai/resources/shared";

export interface ModelInfo extends vscode.LanguageModelChatInformation {
}

export interface ModelLimits {
    maxInputTokens: number;
    maxOutputTokens: number;
}

export interface ModelCapabilities {
    toolCalling?: boolean;
    imageInput?: boolean;
}

export interface ModelDefinition {
    id: string;
    limits: ModelLimits;
    capabilities?: ModelCapabilities;

    /**
     * Reasoning effort levels this model accepts. When present, the provider
     * attaches a `configurationSchema` so hosts that support the proposed
     * `chatProvider` API render a "Thinking Effort" picker.
     */
    reasoningEffort?: ReasoningEffort[];
}

export interface ModelCandidate {
    name: string;
    models: ModelDefinition[];
}

export const candidates: ModelCandidate[] = [
    // OpenAI models
    {
        name: 'Wingman GPT',
        models: [
            { id: 'gpt-5.4', limits: { maxInputTokens: 400000, maxOutputTokens: 128000 }, capabilities: { toolCalling: true, imageInput: true }, reasoningEffort: ['none', 'low', 'medium', 'high', 'xhigh'] },
            { id: 'gpt-5.2', limits: { maxInputTokens: 400000, maxOutputTokens: 128000 }, capabilities: { toolCalling: true, imageInput: true }, reasoningEffort: ['none', 'low', 'medium', 'high', 'xhigh'] },
            { id: 'gpt-5.1', limits: { maxInputTokens: 400000, maxOutputTokens: 128000 }, capabilities: { toolCalling: true, imageInput: true }, reasoningEffort: ['none', 'low', 'medium', 'high'] },
            { id: 'gpt-5',   limits: { maxInputTokens: 400000, maxOutputTokens: 128000 }, capabilities: { toolCalling: true, imageInput: true }, reasoningEffort: ['minimal', 'low', 'medium', 'high'] },
        ],
    },
    {
        name: 'Wingman GPT Mini',
        models: [
            { id: 'gpt-5.4-mini', limits: { maxInputTokens: 400000, maxOutputTokens: 128000 }, capabilities: { toolCalling: true, imageInput: true }, reasoningEffort: ['none', 'low', 'medium', 'high', 'xhigh'] },
            { id: 'gpt-5-mini',   limits: { maxInputTokens: 400000, maxOutputTokens: 128000 }, capabilities: { toolCalling: true, imageInput: true }, reasoningEffort: ['minimal', 'low', 'medium', 'high'] },
        ],
    },
    {
        name: 'Wingman Codex',
        models: [
            { id: 'gpt-5.3-codex', limits: { maxInputTokens: 400000, maxOutputTokens: 128000 }, capabilities: { toolCalling: true, imageInput: true }, reasoningEffort: ['low', 'medium', 'high', 'xhigh'] },
            { id: 'gpt-5.2-codex', limits: { maxInputTokens: 400000, maxOutputTokens: 128000 }, capabilities: { toolCalling: true, imageInput: true }, reasoningEffort: ['low', 'medium', 'high', 'xhigh'] },
        ],
    },
    {
        name: 'Wingman Codex Mini',
        models: [
            { id: 'gpt-5.3-codex-spark', limits: { maxInputTokens: 128000, maxOutputTokens:  32000 }, capabilities: { toolCalling: true }, reasoningEffort: ['low', 'medium', 'high', 'xhigh'] },
            { id: 'gpt-5.1-codex-mini',  limits: { maxInputTokens: 400000, maxOutputTokens: 128000 }, capabilities: { toolCalling: true, imageInput: true }, reasoningEffort: ['low', 'medium', 'high', 'xhigh'] },
        ],
    },

    // Gemini models
    {
        name: 'Wingman Gemini',
        models: [
            { id: 'gemini-3.1-pro-preview', limits: { maxInputTokens: 200000, maxOutputTokens: 64000 }, capabilities: { toolCalling: true, imageInput: true } },
            { id: 'gemini-3-pro-preview',   limits: { maxInputTokens: 200000, maxOutputTokens: 64000 }, capabilities: { toolCalling: true, imageInput: true } },
            { id: 'gemini-2.5-pro',         limits: { maxInputTokens: 200000, maxOutputTokens: 64000 }, capabilities: { toolCalling: true, imageInput: true } },
        ],
    },
    {
        name: 'Wingman Gemini Flash',
        models: [
            { id: 'gemini-3-flash-preview', limits: { maxInputTokens: 200000, maxOutputTokens: 64000 }, capabilities: { toolCalling: true, imageInput: true } },
            { id: 'gemini-2.5-flash',       limits: { maxInputTokens: 200000, maxOutputTokens: 64000 }, capabilities: { toolCalling: true, imageInput: true } },
        ],
    },

    // Claude models
    {
        name: 'Wingman Opus',
        models: [
            { id: 'claude-opus-4-7', limits: { maxInputTokens: 200000, maxOutputTokens: 128000 }, capabilities: { toolCalling: true, imageInput: true }, reasoningEffort: ['minimal', 'low', 'medium', 'high', 'xhigh'] },
            { id: 'claude-opus-4-6', limits: { maxInputTokens: 200000, maxOutputTokens: 128000 }, capabilities: { toolCalling: true, imageInput: true }, reasoningEffort: ['minimal', 'low', 'medium', 'high'] },
            { id: 'claude-opus-4-5', limits: { maxInputTokens: 200000, maxOutputTokens:  64000 }, capabilities: { toolCalling: true, imageInput: true }, reasoningEffort: ['minimal', 'low', 'medium', 'high'] },
        ],
    },
    {
        name: 'Wingman Sonnet',
        models: [
            { id: 'claude-sonnet-4-6', limits: { maxInputTokens: 200000, maxOutputTokens: 64000 }, capabilities: { toolCalling: true, imageInput: true }, reasoningEffort: ['minimal', 'low', 'medium', 'high'] },
            { id: 'claude-sonnet-4-5', limits: { maxInputTokens: 200000, maxOutputTokens: 64000 }, capabilities: { toolCalling: true, imageInput: true }, reasoningEffort: ['minimal', 'low', 'medium', 'high'] },
        ],
    },
    {
        name: 'Wingman Haiku',
        models: [
            { id: 'claude-haiku-4-6', limits: { maxInputTokens: 200000, maxOutputTokens: 64000 }, capabilities: { toolCalling: true, imageInput: true }, reasoningEffort: ['minimal', 'low', 'medium', 'high'] },
            { id: 'claude-haiku-4-5', limits: { maxInputTokens: 200000, maxOutputTokens: 64000 }, capabilities: { toolCalling: true, imageInput: true }, reasoningEffort: ['minimal', 'low', 'medium', 'high'] },
        ],
    },

    // Devstral models
    {
        name: 'Wingman Devstral',
        models: [
            { id: 'devstral',               limits: { maxInputTokens: 256000, maxOutputTokens: 256000 }, capabilities: { toolCalling: true } },
            { id: 'devstral-medium',        limits: { maxInputTokens: 256000, maxOutputTokens: 256000 }, capabilities: { toolCalling: true } },
            { id: 'devstral-medium-latest', limits: { maxInputTokens: 256000, maxOutputTokens: 256000 }, capabilities: { toolCalling: true } },
        ],
    },
    {
        name: 'Wingman Devstral Small',
        models: [
            { id: 'devstral-small',        limits: { maxInputTokens: 256000, maxOutputTokens: 256000 }, capabilities: { toolCalling: true } },
            { id: 'devstral-small-latest', limits: { maxInputTokens: 256000, maxOutputTokens: 256000 }, capabilities: { toolCalling: true } },
        ],
    },

    // GLM models
    {
        name: 'Wingman GLM',
        models: [
            { id: 'glm-5',   limits: { maxInputTokens: 200000, maxOutputTokens: 128000 }, capabilities: { toolCalling: true } },
            { id: 'glm-4.7', limits: { maxInputTokens: 200000, maxOutputTokens: 128000 }, capabilities: { toolCalling: true } },
        ],
    },
    {
        name: 'Wingman GLM Flash',
        models: [
            { id: 'glm-4.7-flash', limits: { maxInputTokens: 200000, maxOutputTokens: 128000 }, capabilities: { toolCalling: true } },
        ],
    },

    // Qwen models
    {
        name: 'Wingman Qwen',
        models: [
            { id: 'qwen3.5',    limits: { maxInputTokens: 256000, maxOutputTokens: 64000 }, capabilities: { toolCalling: true } },
            { id: 'qwen3-next', limits: { maxInputTokens: 128000, maxOutputTokens: 32000 }, capabilities: { toolCalling: true } },
            { id: 'qwen3',      limits: { maxInputTokens: 128000, maxOutputTokens: 16000 }, capabilities: { toolCalling: true } },
        ],
    },
    {
        name: 'Wingman Qwen Coder',
        models: [
            { id: 'qwen3-coder-next', limits: { maxInputTokens: 256000, maxOutputTokens: 64000 }, capabilities: { toolCalling: true } },
            { id: 'qwen3-coder',      limits: { maxInputTokens: 256000, maxOutputTokens: 64000 }, capabilities: { toolCalling: true } },
        ],
    },
];
