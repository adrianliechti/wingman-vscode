import * as vscode from "vscode";

import OpenAI from 'openai';
import { ChatCompletionContentPart, ChatCompletionContentPartText, ChatCompletionMessageParam, ChatCompletionMessageToolCall, ChatCompletionTool } from "openai/resources/chat/completions";
import { ModelInfo, candidates } from "./models";

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
        const models = new Set((await client.models.list()).data.map(model => model.id));

        if (token.isCancellationRequested) {
            return [];
        }

        const results = candidates.flatMap(candidate => {
            const match = candidate.models.find(m => models.has(m.id));
            
            if (!match) {
                return [];
            }

            return [{
                id: match.id,
                name: candidate.name,
                
                family: match.id,
                version: "",
                
                maxInputTokens: match.limits.maxInputTokens,
                maxOutputTokens: match.limits.maxOutputTokens,

                capabilities: {
                    imageInput: match.capabilities?.imageInput ?? false,
                    toolCalling: match.capabilities?.toolCalling ?? false,
                },
            }];
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
                        if (this.isValidText(part.value)) {
                            contentParts.push({
                                type: "text",
                                text: part.value
                            });
                        }
                    } else if (part instanceof vscode.LanguageModelDataPart && part.mimeType.startsWith('image/')) {
                        const base64Data = Buffer.from(part.data).toString('base64');
                        contentParts.push({
                            type: "image_url",
                            image_url: {
                                url: `data:${part.mimeType};base64,${base64Data}`
                            }
                        });
                    } else if (this.isToolResultPart(part)) {
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
            } else if (message.role === vscode.LanguageModelChatMessageRole.Assistant) {
                const textParts: Array<ChatCompletionContentPartText> = [];
                const toolCalls: Array<ChatCompletionMessageToolCall> = [];

                for (const part of message.content) {
                    if (part instanceof vscode.LanguageModelTextPart) {
                        if (this.isValidText(part.value)) {
                            textParts.push({
                                type: "text",
                                text: part.value
                            });
                        }
                    } else if (part instanceof vscode.LanguageModelToolCallPart) {
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

    private isValidText(value: string): boolean {
        const trimmed = value.trim();
        return trimmed.length > 0 && trimmed.toLowerCase() !== 'undefined';
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
        return (pr.content ?? []).map(c => {
            if (c instanceof vscode.LanguageModelTextPart) { return c.value; }
            if (typeof c === "string") { return c; }
            try { return JSON.stringify(c); } catch { return ""; }
        }).join("");
    }
}