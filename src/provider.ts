import * as vscode from "vscode";
import { createHash } from "crypto";

import OpenAI from 'openai';

import { ModelInfo, candidates } from "./models";
import { ResponseInputItem, FunctionTool, ResponseOutputItem, ResponseOutputMessage, ResponseReasoningItem } from "openai/resources/responses/responses";

export class ChatModelProvider implements vscode.LanguageModelChatProvider<ModelInfo> {
    private client?: OpenAI;

    private apiKey?: string;
    private baseUrl?: string;

    private readonly logger: vscode.LogOutputChannel;
    private readonly reasoningCache = new Map<string, ResponseReasoningItem[]>();

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
                id: "wingman/" + match.id,
                name: candidate.name,

                family: candidate.name.toLowerCase().replace(/ /g, '-'),
                version: "",

                maxInputTokens: match.limits.maxInputTokens- match.limits.maxOutputTokens,
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

        const input: ResponseInputItem[] = [];
        let instructions: string | undefined;

        const tools: FunctionTool[] = options.tools?.map(tool => ({
            type: "function" as const,
            name: tool.name,
            description: tool.description,
            parameters: tool.inputSchema as any,
            strict: false,
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
                    if (!instructions) {
                        instructions = textContent;
                    } else {
                        input.push({
                            role: "developer",
                            content: [{ type: "input_text", text: textContent }],
                        });
                    }
                }
                continue;
            }

            if (message.role === vscode.LanguageModelChatMessageRole.User) {
                for (const part of message.content) {
                    if (this.isToolResultPart(part)) {
                        input.push({
                            type: "function_call_output",
                            call_id: part.callId,
                            output: this.collectToolResultText(part),
                        });
                    }
                }

                const contentParts: Array<{ type: "input_text"; text: string } | { type: "input_image"; image_url: string; detail: "auto" }> = [];

                for (const part of message.content) {
                    if (part instanceof vscode.LanguageModelTextPart) {
                        if (this.isValidText(part.value)) {
                            contentParts.push({
                                type: "input_text",
                                text: part.value,
                            });
                        }
                    } else if (part instanceof vscode.LanguageModelDataPart && part.mimeType.startsWith('image/')) {
                        const base64Data = Buffer.from(part.data).toString('base64');
                        contentParts.push({
                            type: "input_image",
                            image_url: `data:${part.mimeType};base64,${base64Data}`,
                            detail: "auto",
                        });
                    }
                }

                if (contentParts.length > 0) {
                    input.push({
                        role: "user",
                        content: contentParts,
                    });
                }
            } else if (message.role === vscode.LanguageModelChatMessageRole.Assistant) {
                const hash = createHash('sha256');
                let text = '';
                const toolCalls: ResponseInputItem[] = [];

                for (const part of message.content) {
                    if (part instanceof vscode.LanguageModelTextPart) {
                        if (this.isValidText(part.value)) {
                            text += part.value;
                            hash.update(part.value);
                        }
                    } else if (part instanceof vscode.LanguageModelToolCallPart) {
                        hash.update('\0');
                        hash.update(part.callId);
                        toolCalls.push({
                            type: "function_call",
                            call_id: part.callId,
                            name: part.name,
                            arguments: JSON.stringify(part.input),
                        });
                    }
                }

                // Inject cached reasoning items before the assistant message
                const fingerprint = hash.digest('hex');
                const cachedReasoning = this.reasoningCache.get(fingerprint);
                if (cachedReasoning) {
                    input.push(...cachedReasoning);
                }

                if (text) {
                    input.push({
                        role: "assistant",
                        content: text,
                    });
                }

                input.push(...toolCalls);
            }
        }

        const modelId = model.id.startsWith("wingman/")
            ? model.id.slice("wingman/".length)
            : model.id;

        const stream = client.responses.stream({
            model: modelId,

            include: ['reasoning.encrypted_content'],

            ...(instructions && { instructions }),

            ...(tools.length > 0 && {
                tools: tools,
                tool_choice: options.toolMode === vscode.LanguageModelChatToolMode.Required ? 'required' : 'auto',
                parallel_tool_calls: true,
            }),

            input: input,
        });

        let globalStreamedText = '';
        const streamedTextByItem = new Map<string, string>();

        stream.on('response.output_text.delta', (event) => {
            const itemId = this.getStringProp(event, 'item_id');
            if (itemId) {
                const prev = streamedTextByItem.get(itemId) ?? '';
                streamedTextByItem.set(itemId, prev + event.delta);
            }

            globalStreamedText += event.delta;
            progress.report(new vscode.LanguageModelTextPart(event.delta));
        });

        const cancellationListener = token.onCancellationRequested(() => {
            stream.abort();
        });

        try {
            const response = await stream.finalResponse();

            // Cache reasoning items for future conversation turns
            this.cacheReasoningItems(response.output);

            for (const item of response.output) {
                if (item.type === 'message') {
                    const finalText = this.collectOutputMessageText(item);

                    if (this.isValidText(finalText)) {
                        const itemId = this.getStringProp(item, 'id');
                        const streamedText = (itemId && streamedTextByItem.get(itemId)) || globalStreamedText;
                        const missingText = this.getUnreportedText(streamedText, finalText);
                        if (missingText) {
                            progress.report(new vscode.LanguageModelTextPart(missingText));
                        }
                    }
                }

                if (item.type === "function_call") {
                    let parsedArgs = {};
                    try {
                        parsedArgs = JSON.parse(item.arguments || '{}');
                    } catch (parseError) {
                        this.logger.error('Failed to parse tool arguments:', item.arguments || '');
                    }
                    progress.report(new vscode.LanguageModelToolCallPart(
                        item.call_id,
                        item.name || '',
                        parsedArgs
                    ));
                }
            }
        } catch (error) {
            if (token.isCancellationRequested) {
                return;
            }
            this.logger.error('Response failed:', String(error));
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

    private collectOutputMessageText(message: ResponseOutputMessage): string {
        return message.content.map(part => {
            if (part.type === 'output_text') {
                return part.text;
            }

            return '';
        }).join('');
    }

    private getStringProp(obj: unknown, key: string): string | undefined {
        if (!obj || typeof obj !== 'object') {
            return undefined;
        }

        const value = (obj as Record<string, unknown>)[key];
        return typeof value === 'string' && value.trim().length > 0 ? value : undefined;
    }

    private cacheReasoningItems(output: ResponseOutputItem[]): void {
        const reasoningItems = output.filter(
            (item): item is ResponseReasoningItem => item.type === 'reasoning'
        );

        if (reasoningItems.length === 0) {
            return;
        }

        const hash = createHash('sha256');

        for (const item of output) {
            if (item.type === 'message') {
                hash.update(this.collectOutputMessageText(item));
            } else if (item.type === 'function_call') {
                hash.update('\0');
                hash.update(item.call_id);
            }
        }

        const fingerprint = hash.digest('hex');

        // Cap cache to prevent unbounded growth
        if (this.reasoningCache.size >= 100) {
            const oldest = this.reasoningCache.keys().next().value!;
            this.reasoningCache.delete(oldest);
        }

        this.reasoningCache.set(fingerprint, reasoningItems);
        this.logger.info('Cached', reasoningItems.length, 'reasoning item(s) for fingerprint', fingerprint.substring(0, 8));
    }

    private getUnreportedText(streamedText: string, finalText: string): string {
        if (!streamedText) {
            return finalText;
        }

        if (finalText === streamedText) {
            return '';
        }

        if (finalText.startsWith(streamedText)) {
            return finalText.slice(streamedText.length);
        }

        this.logger.warn('Skipping final text replay due to non-prefix streamed/final mismatch');
        return '';
    }
}
