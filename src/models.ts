import * as vscode from "vscode";

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

export interface ModelCandidate {
    name: string;
    models: Array<{ id: string; limits: ModelLimits; capabilities?: ModelCapabilities }>;
}

export const candidates: ModelCandidate[] = [
    // OpenAI models
    {
        name: 'Wingman GPT',
        models: [
            { id: 'gpt-5.2', limits: { maxInputTokens: 127805, maxOutputTokens:  64000 }, capabilities: { toolCalling: true, imageInput: true } },
            { id: 'gpt-5.1', limits: { maxInputTokens: 127805, maxOutputTokens:  64000 }, capabilities: { toolCalling: true, imageInput: true } },
            { id: 'gpt-5',   limits: { maxInputTokens: 127805, maxOutputTokens: 128000 }, capabilities: { toolCalling: true, imageInput: true } },
        ],
    },
    {
        name: 'Wingman GPT Mini',
        models: [
            { id: 'gpt-5-mini', limits: { maxInputTokens: 127805, maxOutputTokens: 64000 }, capabilities: { toolCalling: true, imageInput: true } },
        ],
    },
    {
        name: 'Wingman Codex',
        models: [
            { id: 'gpt-5.3-codex',     limits: { maxInputTokens: 271805, maxOutputTokens: 128000 }, capabilities: { toolCalling: true, imageInput: true } },
            { id: 'gpt-5.2-codex',     limits: { maxInputTokens: 271805, maxOutputTokens: 128000 }, capabilities: { toolCalling: true, imageInput: true } },
            { id: 'gpt-5.1-codex-max', limits: { maxInputTokens: 127805, maxOutputTokens: 128000 }, capabilities: { toolCalling: true, imageInput: true } },
            { id: 'gpt-5.1-codex',     limits: { maxInputTokens: 127805, maxOutputTokens: 128000 }, capabilities: { toolCalling: true, imageInput: true } },
            { id: 'gpt-5-codex',       limits: { maxInputTokens: 127805, maxOutputTokens: 128000 }, capabilities: { toolCalling: true, imageInput: true } },
        ],
    },
    {
        name: 'Wingman Codex Mini',
        models: [
            { id: 'gpt-5.1-codex-mini', limits: { maxInputTokens: 127805, maxOutputTokens: 128000 }, capabilities: { toolCalling: true, imageInput: true } },
        ],
    },

    // Gemini models
    {
        name: 'Wingman Gemini Pro',
        models: [
            { id: 'gemini-3-pro',         limits: { maxInputTokens: 108609, maxOutputTokens: 64000 }, capabilities: { toolCalling: true, imageInput: true } },
            { id: 'gemini-3-pro-preview', limits: { maxInputTokens: 108609, maxOutputTokens: 64000 }, capabilities: { toolCalling: true, imageInput: true } },
            { id: 'gemini-2.5-pro',       limits: { maxInputTokens: 108609, maxOutputTokens: 64000 }, capabilities: { toolCalling: true, imageInput: true } },
        ],
    },
    {
        name: 'Wingman Gemini Flash',
        models: [
            { id: 'gemini-3-flash',         limits: { maxInputTokens: 108609, maxOutputTokens: 64000 }, capabilities: { toolCalling: true, imageInput: true } },
            { id: 'gemini-3-flash-preview', limits: { maxInputTokens: 108609, maxOutputTokens: 64000 }, capabilities: { toolCalling: true, imageInput: true } },
            { id: 'gemini-2.5-flash',       limits: { maxInputTokens: 108609, maxOutputTokens: 64000 }, capabilities: { toolCalling: true, imageInput: true } },
        ],
    },

    // Claude models
    {
        name: 'Wingman Claude Opus',
        models: [
            { id: 'claude-opus-4-6', limits: { maxInputTokens: 127805, maxOutputTokens: 64000 }, capabilities: { toolCalling: true, imageInput: true } },
            { id: 'claude-opus-4-5', limits: { maxInputTokens: 127805, maxOutputTokens: 32000 }, capabilities: { toolCalling: true, imageInput: true } },
        ],
    },
    {
        name: 'Wingman Claude Sonnet',
        models: [
            { id: 'claude-sonnet-4-6', limits: { maxInputTokens: 127805, maxOutputTokens: 32000 }, capabilities: { toolCalling: true, imageInput: true } },
            { id: 'claude-sonnet-4-5', limits: { maxInputTokens: 127805, maxOutputTokens: 32000 }, capabilities: { toolCalling: true, imageInput: true } },
        ],
    },
    {
        name: 'Wingman Claude Haiku',
        models: [
            { id: 'claude-haiku-4-6', limits: { maxInputTokens: 127805, maxOutputTokens: 32000 }, capabilities: { toolCalling: true, imageInput: true } },
            { id: 'claude-haiku-4-5', limits: { maxInputTokens: 127805, maxOutputTokens: 32000 }, capabilities: { toolCalling: true, imageInput: true } },
        ],
    },

    // GLM models
    {
        name: 'Wingman GLM',
        models: [
            { id: 'glm-5',   limits: { maxInputTokens: 127805, maxOutputTokens: 128000 }, capabilities: { toolCalling: true } },
            { id: 'glm-4.7', limits: { maxInputTokens: 127805, maxOutputTokens: 128000 }, capabilities: { toolCalling: true } },
        ],
    },
    {
        name: 'Wingman GLM Flash',
        models: [
            { id: 'glm-4.7-flash', limits: { maxInputTokens: 127805, maxOutputTokens: 128000 }, capabilities: { toolCalling: true } },
        ],
    },

    // Qwen models
    {
        name: 'Wingman Qwen',
        models: [
            { id: 'qwen3.5',    limits: { maxInputTokens: 127805, maxOutputTokens: 128000 }, capabilities: { toolCalling: true } },
            { id: 'qwen3-next', limits: { maxInputTokens: 127805, maxOutputTokens: 128000 }, capabilities: { toolCalling: true } },
            { id: 'qwen3',      limits: { maxInputTokens: 127805, maxOutputTokens: 128000 }, capabilities: { toolCalling: true } },
        ],
    },
    {
        name: 'Wingman Qwen Coder',
        models: [
            { id: 'qwen3-coder-next', limits: { maxInputTokens: 127805, maxOutputTokens: 128000 }, capabilities: { toolCalling: true } },
            { id: 'qwen3-coder',      limits: { maxInputTokens: 127805, maxOutputTokens: 128000 }, capabilities: { toolCalling: true } },
        ],
    },
];
