import * as vscode from "vscode";

import OpenAI from 'openai';

import { type ModelInfo, candidates } from "./models";
import type { ResponseInputItem, FunctionTool } from "openai/resources/responses/responses";
import type { ReasoningEffort } from "openai/resources/shared";

/**
 * Shape matches the proposed `LanguageModelConfigurationSchema` from
 * `vscode.proposed.chatProvider.d.ts`. We attach it via a cast so this works
 * on stable `@types/vscode` (where it's ignored) and is picked up on hosts
 * that support the `chatProvider` proposed API.
 */
function buildReasoningConfigurationSchema(levels: ReasoningEffort[]): Record<string, unknown> {
    const defaultEffort: ReasoningEffort | undefined = levels.includes('medium') ? 'medium' : undefined;

    return {
        properties: {
            reasoningEffort: {
                type: 'string',
                title: 'Thinking Effort',
                enum: levels,
                enumItemLabels: levels.map(l => String(l).charAt(0).toUpperCase() + String(l).slice(1)),
                enumDescriptions: levels.map(describeReasoningEffort),
                ...(defaultEffort && { default: defaultEffort }),
                group: 'navigation',
            },
        },
    };
}

function describeReasoningEffort(level: ReasoningEffort): string {
    switch (level) {
        case 'none': return 'No reasoning applied';
        case 'minimal': return 'Fastest time-to-first-token with minimal reasoning';
        case 'low': return 'Faster responses with less reasoning';
        case 'medium': return 'Balanced reasoning and speed';
        case 'high': return 'Greater reasoning depth but slower';
        case 'xhigh': return 'Maximum reasoning depth but slower';
        default: return String(level ?? '');
    }
}

export class ChatModelProvider implements vscode.LanguageModelChatProvider<ModelInfo> {
    private client?: OpenAI;

    private apiKey?: string;
    private baseUrl?: string;

    private readonly logger: vscode.LogOutputChannel;

    constructor(context: vscode.ExtensionContext, logger: vscode.LogOutputChannel) {
        this.logger = logger;

        context.subscriptions.push(
            vscode.workspace.onDidChangeConfiguration(e => {
                if (e.affectsConfiguration('wingman')) {
                    this.client = undefined;
                    this.logger.info('Configuration changed, client invalidated');
                }
            })
        );
    }

    async provideLanguageModelChatInformation(_options: vscode.PrepareLanguageModelChatModelOptions, token: vscode.CancellationToken): Promise<ModelInfo[]> {
        if (token.isCancellationRequested) {
            return [];
        }

        const client = await this.createClient();
        const models = new Set((await client.models.list()).data.map(model => model.id));

        if (token.isCancellationRequested) {
            return [];
        }

        const results = candidates.flatMap(candidate => {
            const matchedId = candidate.id.find(id => models.has(id));
            if (!matchedId) {
                return [];
            }

            const info: ModelInfo = {
                id: `wingman/${matchedId}`,
                name: candidate.name,

                family: matchedId,
                version: "",

                maxInputTokens: candidate.limits.maxInputTokens - candidate.limits.maxOutputTokens,
                maxOutputTokens: candidate.limits.maxOutputTokens,

                capabilities: {
                    imageInput: candidate.capabilities?.imageInput ?? false,
                    toolCalling: candidate.capabilities?.toolCalling ?? false,
                },
            };

            if (candidate.reasoningEffort && candidate.reasoningEffort.length > 0) {
                (info as unknown as Record<string, unknown>).configurationSchema =
                    buildReasoningConfigurationSchema(candidate.reasoningEffort);
            }

            return [info];
        });

        this.logger.info('Available models:', results.map(r => r.id).join(', ') || 'none');

        return results;
    }

    async provideTokenCount(_model: ModelInfo, text: string | vscode.LanguageModelChatRequestMessage, _token: vscode.CancellationToken): Promise<number> {
        const str = typeof text === "string" ? text : JSON.stringify(text);
        return Math.ceil(str.length / 4);
    }

    async provideLanguageModelChatResponse(model: ModelInfo, messages: readonly vscode.LanguageModelChatRequestMessage[], options: vscode.ProvideLanguageModelChatResponseOptions, progress: vscode.Progress<vscode.LanguageModelResponsePart>, token: vscode.CancellationToken): Promise<void> {
        if (token.isCancellationRequested) {
            return;
        }

        const client = await this.createClient();

        if (options.tools) {
            for (const tool of options.tools) {
                if (!/^[\w-]+$/.test(tool.name)) {
                    throw new Error(`Invalid tool name "${tool.name}": only alphanumeric characters, hyphens, and underscores are allowed.`);
                }
            }
        }

        const tools: FunctionTool[] = options.tools?.map(tool => ({
            type: "function" as const,
            name: tool.name,
            description: tool.description,
            parameters: tool.inputSchema as Record<string, unknown>,
            strict: false,
        })) ?? [];

        const ThinkingPartCtor = (vscode as Record<string, unknown>)['LanguageModelThinkingPart'] as
            (new (value: string, id?: string, metadata?: { readonly [key: string]: unknown }) => vscode.LanguageModelResponsePart) | undefined;

        // Translate VS Code chat history into Responses API input items.
        // Thinking parts are intentionally not round-tripped: encrypted reasoning
        // is bound to the provider key/deployment and breaks on model swaps and
        // multi-subscription routing.
        const input: ResponseInputItem[] = [];
        const systemTexts: string[] = [];

        for (const message of messages) {
            if (message.role !== vscode.LanguageModelChatMessageRole.User &&
                message.role !== vscode.LanguageModelChatMessageRole.Assistant) {
                const textContent = message.content
                    .filter((part): part is vscode.LanguageModelTextPart => part instanceof vscode.LanguageModelTextPart)
                    .map(part => part.value)
                    .join("");

                if (textContent.trim()) {
                    systemTexts.push(textContent);
                }
                continue;
            }

            if (message.role === vscode.LanguageModelChatMessageRole.User) {
                const contentParts: Array<{ type: "input_text"; text: string } | { type: "input_image"; image_url: string; detail: "auto" }> = [];

                for (const part of message.content) {
                    if (part && typeof part === "object" && "callId" in part && "content" in part && typeof (part as { callId: unknown }).callId === "string") {
                        const toolResult = part as { callId: string; content?: ReadonlyArray<unknown> };
                        const text = (toolResult.content ?? []).map(c => {
                            if (c instanceof vscode.LanguageModelTextPart) { return c.value; }
                            if (typeof c === "string") { return c; }
                            // Drop opaque data parts (e.g. prompt-cache breakpoints with
                            // mimeType "cache_control") so host tooling metadata doesn't
                            // leak into the model-visible tool output.
                            if (c instanceof vscode.LanguageModelDataPart) { return ""; }
                            if (c && typeof c === "object" && "mimeType" in c && "data" in c) { return ""; }
                            try { return JSON.stringify(c); } catch { return ""; }
                        }).join("");

                        input.push({
                            type: "function_call_output",
                            call_id: toolResult.callId,
                            output: text,
                        });
                    } else if (part instanceof vscode.LanguageModelTextPart) {
                        if (this.isValidText(part.value)) {
                            contentParts.push({ type: "input_text", text: part.value });
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
                    input.push({ role: "user", content: contentParts });
                }
            } else {
                let text = '';
                const toolCalls: ResponseInputItem[] = [];

                for (const part of message.content) {
                    if (part instanceof vscode.LanguageModelTextPart) {
                        if (this.isValidText(part.value)) {
                            text += part.value;
                        }
                    } else if (part instanceof vscode.LanguageModelToolCallPart) {
                        toolCalls.push({
                            type: "function_call",
                            call_id: part.callId,
                            name: part.name,
                            arguments: JSON.stringify(part.input),
                        });
                    }
                }

                if (text) {
                    input.push({ role: "assistant", content: text });
                }
                input.push(...toolCalls);
            }
        }

        // Drop function_call items without a paired function_call_output. VS Code
        // histories with cancelled tool calls would otherwise trigger a 400 from
        // the Responses API ("function_call was provided without its required
        // following item").
        const completedCallIds = new Set<string>();
        for (const item of input) {
            if (item.type === 'function_call_output' && typeof item.call_id === 'string') {
                completedCallIds.add(item.call_id);
            }
        }
        const sanitizedInput = input.filter(item =>
            item.type !== 'function_call' ||
            (typeof item.call_id === 'string' && completedCallIds.has(item.call_id))
        );
        if (sanitizedInput.length !== input.length) {
            this.logger.warn(`Dropped ${input.length - sanitizedInput.length} orphan tool call(s) before request.`);
        }

        const modelId = model.id.startsWith("wingman/")
            ? model.id.slice("wingman/".length)
            : model.id;

        const instructions = systemTexts.join('\n\n') || undefined;

        // Resolve requested reasoning effort against what this model supports.
        // 'none' means "skip reasoning" — omit the reasoning block entirely.
        const modelConfiguration =
            (options as unknown as { modelConfiguration?: Record<string, unknown> })
                .modelConfiguration;
        const supportedEfforts = candidates.find(c => c.id.includes(modelId))?.reasoningEffort ?? [];
        const rawEffort = modelConfiguration?.['reasoningEffort'];
        const requestedEffort = typeof rawEffort === 'string' && (supportedEfforts as string[]).includes(rawEffort)
            ? (rawEffort as ReasoningEffort)
            : undefined;
        const effectiveEffort: ReasoningEffort | undefined = requestedEffort === 'none'
            ? undefined
            : requestedEffort ?? (supportedEfforts.includes('medium') ? 'medium' : undefined);

        const stream = client.responses.stream({
            model: modelId,
            ...(instructions && { instructions }),
            ...(tools.length > 0 && {
                tools,
                tool_choice: options.toolMode === vscode.LanguageModelChatToolMode.Required ? 'required' : 'auto',
                parallel_tool_calls: true,
            }),
            ...(effectiveEffort && {
                reasoning: { effort: effectiveEffort, summary: 'auto' },
            }),
            input: sanitizedInput,
        });

        const streamedTextByItem = new Map<string, string>();
        let globalStreamedText = '';
        const reasoningStreamedIds = new Set<string>();
        let thinkingActive = false;

        const endThinkingIfActive = () => {
            if (thinkingActive && ThinkingPartCtor) {
                progress.report(new ThinkingPartCtor('', undefined, { vscode_reasoning_done: true }));
                thinkingActive = false;
            }
        };

        stream.on('response.output_text.delta', (event) => {
            endThinkingIfActive();
            const itemId = typeof event.item_id === 'string' ? event.item_id : undefined;
            if (itemId) {
                streamedTextByItem.set(itemId, (streamedTextByItem.get(itemId) ?? '') + event.delta);
            }
            globalStreamedText += event.delta;
            progress.report(new vscode.LanguageModelTextPart(event.delta));
        });

        if (ThinkingPartCtor) {
            stream.on('response.reasoning_summary_text.delta', (event) => {
                const itemId = typeof event.item_id === 'string' ? event.item_id : undefined;
                if (itemId) {
                    reasoningStreamedIds.add(itemId);
                }
                progress.report(new ThinkingPartCtor(event.delta, itemId));
                thinkingActive = true;
            });
        }

        const cancellationListener = token.onCancellationRequested(() => {
            stream.abort();
        });

        try {
            const response = await stream.finalResponse();

            for (const item of response.output) {
                if (item.type === 'reasoning') {
                    // If the stream already emitted this reasoning content, skip —
                    // closer is handled by endThinkingIfActive on the next item or
                    // at the end of the loop.
                    if (ThinkingPartCtor && !reasoningStreamedIds.has(item.id)) {
                        const text = (item.summary ?? [])
                            .map(s => s.type === 'summary_text' ? s.text : '')
                            .join('');
                        if (text) {
                            progress.report(new ThinkingPartCtor(text, item.id));
                            thinkingActive = true;
                        }
                    }
                    continue;
                }

                if (item.type === 'message') {
                    endThinkingIfActive();
                    const finalText = item.content
                        .map(part => part.type === 'output_text' ? part.text : '')
                        .join('');
                    if (this.isValidText(finalText)) {
                        const streamedText = streamedTextByItem.get(item.id) || globalStreamedText;
                        let missingText = '';
                        if (!streamedText) {
                            missingText = finalText;
                        } else if (finalText.startsWith(streamedText)) {
                            missingText = finalText.slice(streamedText.length);
                        } else if (finalText !== streamedText) {
                            this.logger.warn('Skipping final text replay due to non-prefix streamed/final mismatch');
                        }
                        if (missingText) {
                            progress.report(new vscode.LanguageModelTextPart(missingText));
                        }
                    }
                    continue;
                }

                if (item.type === 'function_call') {
                    endThinkingIfActive();
                    let parsedArgs = {};
                    try {
                        parsedArgs = JSON.parse(item.arguments || '{}');
                    } catch {
                        this.logger.error('Failed to parse tool arguments:', item.arguments || '');
                    }
                    progress.report(new vscode.LanguageModelToolCallPart(
                        item.call_id,
                        item.name || '',
                        parsedArgs
                    ));
                }
            }

            // Reasoning-only responses (no following message/tool to trigger the
            // boundary close) — flush any open thinking phase now.
            endThinkingIfActive();
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
        const apiKey = config.get<string>('apiKey', '-');

        if (this.client && this.baseUrl === baseUrl && this.apiKey === apiKey) {
            return this.client;
        }

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
        return value.trim().length > 0;
    }
}
