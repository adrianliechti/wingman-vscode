import * as vscode from "vscode";

export interface ModelLimits {
    maxInputTokens: number;
    maxOutputTokens: number;
}

export interface ModelInfo extends vscode.LanguageModelChatInformation {
}

export const defaultModelLimits: ModelLimits = { maxInputTokens: 128000, maxOutputTokens: 16000 };

export const modelLimits: Record<string, ModelLimits> = {
    // OpenAI models
    'gpt-5.3-codex':      { maxInputTokens: 271805, maxOutputTokens: 128000 },
    'gpt-5.2-codex':      { maxInputTokens: 271805, maxOutputTokens: 128000 },
    'gpt-5.2':            { maxInputTokens: 127805, maxOutputTokens: 64000 },
    'gpt-5.1-codex-max':  { maxInputTokens: 127805, maxOutputTokens: 128000 },
    'gpt-5.1-codex':      { maxInputTokens: 127805, maxOutputTokens: 128000 },
    'gpt-5.1':            { maxInputTokens: 127805, maxOutputTokens: 64000 },
    'gpt-5-codex':        { maxInputTokens: 127805, maxOutputTokens: 128000 },
    'gpt-5':              { maxInputTokens: 127805, maxOutputTokens: 128000 },
    'gpt-5.1-codex-mini': { maxInputTokens: 127805, maxOutputTokens: 128000 },
    'gpt-5-mini':         { maxInputTokens: 127805, maxOutputTokens: 64000 },

    // Gemini models
    'gemini-3-pro':           { maxInputTokens: 108609, maxOutputTokens: 64000 },
    'gemini-3-pro-preview':   { maxInputTokens: 108609, maxOutputTokens: 64000 },
    'gemini-2.5-pro':         { maxInputTokens: 108609, maxOutputTokens: 64000 },
    'gemini-3-flash':         { maxInputTokens: 108609, maxOutputTokens: 64000 },
    'gemini-3-flash-preview': { maxInputTokens: 108609, maxOutputTokens: 64000 },
    'gemini-2.5-flash':       { maxInputTokens: 108609, maxOutputTokens: 64000 },

    // Claude models
    'claude-opus-4-6':   { maxInputTokens: 127805, maxOutputTokens: 64000 },
    'claude-opus-4-5':   { maxInputTokens: 127805, maxOutputTokens: 32000 },
    'claude-sonnet-4-5': { maxInputTokens: 127805, maxOutputTokens: 32000 },
    'claude-haiku-4-5':  { maxInputTokens: 127805, maxOutputTokens: 32000 },
};

export const candidates: Array<{ name: string; models: string[] }> = [
    // OpenAI models
    { name: 'Wingman Codex', models: ['gpt-5.3-codex', 'gpt-5.2-codex', 'gpt-5.2', 'gpt-5.1-codex-max', 'gpt-5.1-codex', 'gpt-5.1', 'gpt-5-codex', 'gpt-5'] },
    { name: 'Wingman Codex Mini', models: ['gpt-5.1-codex-mini', 'gpt-5-mini'] },

    // Gemini models
    { name: 'Wingman Gemini Pro', models: ['gemini-3-pro', 'gemini-3-pro-preview', 'gemini-2.5-pro'] },
    { name: 'Wingman Gemini Flash', models: ['gemini-3-flash', 'gemini-3-flash-preview', 'gemini-2.5-flash'] },

    // Claude models
    { name: 'Wingman Claude Opus', models: [ 'claude-opus-4-6', 'claude-opus-4-5'] },
    { name: 'Wingman Claude Sonnet', models: ['claude-sonnet-4-5'] },
    { name: 'Wingman Claude Haiku', models: ['claude-haiku-4-5'] },
];
