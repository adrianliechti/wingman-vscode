import * as vscode from "vscode";

import OpenAI from 'openai';
import { ChatCompletionContentPart, ChatCompletionContentPartText, ChatCompletionMessageParam, ChatCompletionMessageToolCall, ChatCompletionTool } from "openai/resources/chat/completions";

interface ModelLimits {
    maxInputTokens: number;
    maxOutputTokens: number;
}

interface ModelInfo extends vscode.LanguageModelChatInformation {
}

const defaultModelLimits: ModelLimits = { maxInputTokens: 128000, maxOutputTokens: 16000 };

const modelLimits: Record<string, ModelLimits> = {
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
    'gemini-3-flash-preview': { maxInputTokens: 108609, maxOutputTokens: 64000 },
    'gemini-2.5-flash':       { maxInputTokens: 108609, maxOutputTokens: 64000 },

    // Claude models
    'claude-opus-4-6':   { maxInputTokens: 127805, maxOutputTokens: 64000 },
    'claude-opus-4-5':   { maxInputTokens: 127805, maxOutputTokens: 32000 },
    'claude-sonnet-4-5': { maxInputTokens: 127805, maxOutputTokens: 32000 },
    'claude-haiku-4-5':  { maxInputTokens: 127805, maxOutputTokens: 32000 },
};

export class ChatModelProvider implements vscode.LanguageModelChatProvider<ModelInfo> {
    private client?: OpenAI;

    private apiKey?: string;
    private baseUrl?: string;

    private readonly logger: vscode.LogOutputChannel;

    constructor(context: vscode.ExtensionContext, logger: vscode.LogOutputChannel) {
        this.logger = logger;

        // Listen for configuration changes to invalidate cached client
        context.subscriptions.push(
            vscode.workspace.onDidChangeConfiguration(e => {
                if (e.affectsConfiguration('wingman')) {
                    this.client = undefined;
                    this.logger.info('Configuration changed, client invalidated');
                }
            })
        );
    }

    async provideLanguageModelChatInformation(options: vscode.PrepareLanguageModelChatModelOptions, token: vscode.CancellationToken): Promise<ModelInfo[]> {
        if (token.isCancellationRequested) {
            return [];
        }

        const client = await this.createClient();
        const list = await client.models.list();

        if (token.isCancellationRequested) {
            return [];
        }

        const availableModels = new Set(list.data.map(model => model.id));

        // Define candidate groups - each group uses the first available model from its list
        const candidates: Array<{ name: string; models: string[] }> = [
            // OpenAI models
            { name: 'Wingman Codex', models: ['gpt-5.3-codex', 'gpt-5.2-codex', 'gpt-5.2', 'gpt-5.1-codex-max', 'gpt-5.1-codex', 'gpt-5.1', 'gpt-5-codex', 'gpt-5'] },
            { name: 'Wingman Codex Mini', models: ['gpt-5.1-codex-mini', 'gpt-5-mini'] },

            // Gemini models
            { name: 'Wingman Gemini Pro', models: ['gemini-3-pro', 'gemini-3-pro-preview', 'gemini-2.5-pro'] },
            { name: 'Wingman Gemini Flash', models: ['gemini-3-flash-preview', 'gemini-2.5-flash'] },

            // Claude models
            { name: 'Wingman Claude Sonnet', models: ['claude-sonnet-4-5'] },
            { name: 'Wingman Claude Opus', models: [ 'claude-opus-4-6', 'claude-opus-4-5'] },
            { name: 'Wingman Claude Haiku', models: ['claude-haiku-4-5'] },
        ];

        // For each candidate group, find the first available model
        const results: ModelInfo[] = candidates
            .map(candidate => {
                const modelId = candidate.models.find(id => availableModels.has(id));
                return modelId ? { modelId, name: candidate.name } : null;
            })
            .filter(<T>(entry: T): entry is NonNullable<T> => entry !== null)
            .map(entry => {
                const limits = modelLimits[entry.modelId] ?? defaultModelLimits;
                return {
                    id: entry.modelId,
                    name: entry.name,
                    family: entry.modelId,
                    version: "",
                    maxInputTokens: limits.maxInputTokens,
                    maxOutputTokens: limits.maxOutputTokens,
                    capabilities: {
                        toolCalling: true,
                        imageInput: true,
                    },
                };
            });

        this.logger.info('Available models:', results.map(r => r.id).join(', ') || 'none');

        return results;
    }

    async provideTokenCount(model: ModelInfo, text: string | vscode.LanguageModelChatRequestMessage, token: vscode.CancellationToken): Promise<number> {
        if (typeof text === "string") {
            return Math.ceil(text.length / 4);
        }

        const json = JSON.stringify(text);
        return Math.ceil(json.length / 4);
    }

    async provideLanguageModelChatResponse(model: ModelInfo, messages: readonly vscode.LanguageModelChatRequestMessage[], options: vscode.ProvideLanguageModelChatResponseOptions, progress: vscode.Progress<vscode.LanguageModelResponsePart>, token: vscode.CancellationToken): Promise<void> {
        if (token.isCancellationRequested) {
            return;
        }

        const client = await this.createClient();

        const input: ChatCompletionMessageParam[] = [];

        const tools: ChatCompletionTool[] = options.tools?.map(tool => ({
            type: "function",
            function: {
                name: tool.name,
                description: tool.description,
                parameters: tool.inputSchema as any
            }
        })) ?? [];

        for (const message of messages) {
            // Handle System messages (any role that's not User or Assistant)
            if (message.role !== vscode.LanguageModelChatMessageRole.User &&
                message.role !== vscode.LanguageModelChatMessageRole.Assistant) {
                const textContent = message.content
                    .filter((part): part is vscode.LanguageModelTextPart => part instanceof vscode.LanguageModelTextPart)
                    .map(part => part.value)
                    .join("");

                if (textContent.trim()) {
                    input.push({
                        role: "system",
                        content: textContent
                    });
                }
                continue;
            }

            if (message.role === vscode.LanguageModelChatMessageRole.User) {
                const contentParts: Array<ChatCompletionContentPart> = [];

                for (const part of message.content) {
                    if (part instanceof vscode.LanguageModelTextPart) {
                        if (part.value.trim() && part.value.trim().toLowerCase() !== 'undefined') {
                            contentParts.push({
                                type: "text",
                                text: part.value
                            });
                        }
                    }

                    if (part instanceof vscode.LanguageModelDataPart && part.mimeType.startsWith('image/')) {
                        const base64Data = Buffer.from(part.data).toString('base64');
                        contentParts.push({
                            type: "image_url",
                            image_url: {
                                url: `data:${part.mimeType};base64,${base64Data}`
                            }
                        });
                    }

                    if (this.isToolResultPart(part)) {
                        const toolResultContent = this.collectToolResultText(part);

                        if (toolResultContent.trim()) {
                            input.push({
                                role: "tool",
                                tool_call_id: part.callId,
                                content: toolResultContent
                            });
                        }
                    }
                }

                if (contentParts.length > 0) {
                    input.push({
                        role: "user",
                        content: contentParts
                    });
                }
            }

            if (message.role === vscode.LanguageModelChatMessageRole.Assistant) {
                const textParts: Array<ChatCompletionContentPartText> = [];
                const toolCalls: Array<ChatCompletionMessageToolCall> = [];

                for (const part of message.content) {
                    if (part instanceof vscode.LanguageModelTextPart) {
                        if (part.value.trim() && part.value.trim().toLowerCase() !== 'undefined') {
                            textParts.push({
                                type: "text",
                                text: part.value
                            });
                        }
                    }

                    if (part instanceof vscode.LanguageModelToolCallPart) {
                        toolCalls.push({
                            type: "function",
                            id: part.callId,
                            function: {
                                name: part.name,
                                arguments: JSON.stringify(part.input)
                            }
                        });
                    }
                }

                // Combine text and tool_calls into a single assistant message to avoid consecutive assistant messages
                if (textParts.length > 0 || toolCalls.length > 0) {
                    const assistantMessage: ChatCompletionMessageParam = {
                        role: "assistant",
                        content: textParts.length > 0 ? textParts : null,
                    };

                    if (toolCalls.length > 0) {
                        (assistantMessage as any).tool_calls = toolCalls;
                    }

                    input.push(assistantMessage);
                }
            }
        }

        const runner = client.chat.completions.stream({
            model: model.id,

            ...(tools.length > 0 && {
                tools: tools,
                tool_choice: options.toolMode === vscode.LanguageModelChatToolMode.Required ? 'required' : 'auto',
            }),

            messages: input,
        }).on('content', (diff) => {
            progress.report(new vscode.LanguageModelTextPart(diff));
        });

        const cancellationListener = token.onCancellationRequested(() => {
            runner.abort();
        });

        try {
            const completion = await runner.finalChatCompletion();
            const result = completion.choices[0]?.message;

            if (!result) {
                return;
            }

            result.tool_calls?.forEach(toolCall => {
                if (toolCall.type === "function" && toolCall.id && toolCall.function) {
                    let parsedArgs = {};
                    try {
                        parsedArgs = JSON.parse(toolCall.function.arguments || '{}');
                    } catch (parseError) {
                        this.logger.error('Failed to parse tool arguments:', toolCall.function.arguments || '');
                    }
                    progress.report(new vscode.LanguageModelToolCallPart(
                        toolCall.id,
                        toolCall.function.name || '',
                        parsedArgs
                    ));
                }
            });
        } catch (error) {
            if (token.isCancellationRequested) {
                // Cancellation is expected, don't throw
                return;
            }
            this.logger.error('Chat completion failed:', String(error));
            throw error;
        } finally {
            cancellationListener.dispose();
        }
    }

    private async createClient(): Promise<OpenAI> {
        const config = vscode.workspace.getConfiguration('wingman');

        const baseUrl = config.get<string>('baseUrl', 'http://localhost:4242/v1');
        const apiKey = config.get<string>('apiKey', '');

        // Return cached client if configuration hasn't changed
        if (this.client && this.baseUrl === baseUrl && this.apiKey === apiKey) {
            return this.client;
        }

        // Cache new configuration and create new client
        this.apiKey = apiKey;
        this.baseUrl = baseUrl;

        this.logger.info('Platform:', baseUrl);

        this.client = new OpenAI({
            baseURL: baseUrl,
            apiKey: apiKey,

            organization: null,
            project: null,
            webhookSecret: null
        });

        return this.client;
    }

    private isToolResultPart(value: unknown): value is { callId: string; content?: ReadonlyArray<unknown> } {
        if (!value || typeof value !== "object") {
            return false;
        }

        const obj = value as Record<string, unknown>;
        const hasCallId = typeof obj.callId === "string";
        const hasContent = "content" in obj;
        return hasCallId && hasContent;
    }

    private collectToolResultText(pr: { content?: ReadonlyArray<unknown> }): string {
        let text = "";

        for (const c of pr.content ?? []) {
            if (c instanceof vscode.LanguageModelTextPart) {
                text += c.value;
            } else if (typeof c === "string") {
                text += c;
            } else {
                try {
                    text += JSON.stringify(c);
                } catch {
                }
            }
        }

        return text;
    }
}