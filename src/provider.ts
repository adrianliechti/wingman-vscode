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
 *
 * Mirrors `buildConfigurationSchema` in vscode-copilot-chat's
 * `languageModelAccess.ts` (title, `enumItemLabels`, per-level descriptions).
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
            const match = candidate.models.find(m => models.has(m.id));

            if (!match) {
                return [];
            }

            const info: ModelInfo = {
                id: `wingman/${match.id}`,
                name: candidate.name,

                family: match.id,
                version: "",

                maxInputTokens: match.limits.maxInputTokens- match.limits.maxOutputTokens,
                maxOutputTokens: match.limits.maxOutputTokens,

                capabilities: {
                    imageInput: match.capabilities?.imageInput ?? false,
                    toolCalling: match.capabilities?.toolCalling ?? false,
                },
            };

            // Proposed `chatProvider` API: attach a per-model configuration
            // schema so the host renders a reasoning-effort picker. Cast
            // through `Record<string, unknown>` so stable `@types/vscode`
            // (which doesn't declare `configurationSchema`) still compiles.
            if (match.reasoningEffort && match.reasoningEffort.length > 0) {
                (info as unknown as Record<string, unknown>).configurationSchema =
                    buildReasoningConfigurationSchema(match.reasoningEffort);
            }

            return [info];
        });

        this.logger.info('Available models:', results.map(r => r.id).join(', ') || 'none');

        return results;
    }

    async provideTokenCount(_model: ModelInfo, text: string | vscode.LanguageModelChatRequestMessage, _token: vscode.CancellationToken): Promise<number> {
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

        const input: ResponseInputItem[] = [];
        const systemTexts: string[] = [];

        // Proposed API (dynamic): LanguageModelThinkingPart may arrive in assistant-role
        // content when VS Code has previously emitted thinking in this session.
        const ThinkingPartCtor = (vscode as Record<string, unknown>)['LanguageModelThinkingPart'] as
            (new (value: string, id?: string, metadata?: { readonly [key: string]: unknown }) => vscode.LanguageModelResponsePart) | undefined;

        for (const message of messages) {
            // System / developer messages: concatenate all their text into the top-level instructions.
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
                let text = '';
                const trailingItems: ResponseInputItem[] = [];

                for (const part of message.content) {
                    if (part instanceof vscode.LanguageModelTextPart) {
                        if (this.isValidText(part.value)) {
                            text += part.value;
                        }
                    } else if (part instanceof vscode.LanguageModelToolCallPart) {
                        trailingItems.push({
                            type: "function_call",
                            call_id: part.callId,
                            name: part.name,
                            arguments: JSON.stringify(part.input),
                        });
                    } else if (ThinkingPartCtor && part instanceof ThinkingPartCtor) {
                        // Replay prior reasoning items so stateless requests preserve
                        // chain-of-thought continuity across turns (especially across tool calls).
                        const reasoningItem = this.buildReasoningItem(part);
                        
                        if (reasoningItem) {
                            // Reasoning items must appear before the message/tool_calls they produced.
                            input.push(reasoningItem);
                        }
                    }
                }

                if (text) {
                    input.push({
                        role: "assistant",
                        content: text,
                    });
                }

                input.push(...trailingItems);
            }
        }

        const modelId = model.id.startsWith("wingman/")
            ? model.id.slice("wingman/".length)
            : model.id;

        const instructions = systemTexts.join('\n\n') || undefined;

        // Proposed `chatProvider` API: `options.modelConfiguration` carries
        // per-model user configuration validated against `configurationSchema`.
        // Read it dynamically so this compiles against stable @types/vscode.
        const modelConfiguration =
            (options as unknown as { modelConfiguration?: Record<string, unknown> })
                .modelConfiguration;

        const supportedEfforts = candidates.flatMap(c => c.models).find(m => m.id === modelId)?.reasoningEffort ?? [];
        const rawEffort = modelConfiguration?.['reasoningEffort'];
        const requestedEffort = typeof rawEffort === 'string' && (supportedEfforts as string[]).includes(rawEffort)
            ? (rawEffort as ReasoningEffort)
            : undefined;
        const effectiveEffort: ReasoningEffort | undefined = requestedEffort
            ?? (supportedEfforts.includes('medium') ? 'medium' : undefined);

        const stream = client.responses.stream({
            model: modelId,

            ...(instructions && { instructions }),

            ...(tools.length > 0 && {
                tools: tools,
                tool_choice: options.toolMode === vscode.LanguageModelChatToolMode.Required ? 'required' : 'auto',
                parallel_tool_calls: true,
            }),

            ...(effectiveEffort && {
                reasoning: {
                    effort: effectiveEffort,
                    summary: 'auto',
                },
            }),

            // Ask for encrypted reasoning so we can replay chain-of-thought across turns
            // without relying on server-side state (works under ZDR / store:false too).
            include: ['reasoning.encrypted_content'],

            input: input,
        });

        let globalStreamedText = '';
        const streamedTextByItem = new Map<string, string>();
        const reasoningStreamedIds = new Set<string>();

        let thinkingActive = false;

        const endThinkingIfActive = () => {
            if (thinkingActive && ThinkingPartCtor) {
                progress.report(new ThinkingPartCtor('', '', { vscode_reasoning_done: true }));
                thinkingActive = false;
            }
        };

        stream.on('response.output_text.delta', (event) => {
            endThinkingIfActive();

            const itemId = this.getStringProp(event, 'item_id');
            if (itemId) {
                const prev = streamedTextByItem.get(itemId) ?? '';
                streamedTextByItem.set(itemId, prev + event.delta);
            }

            globalStreamedText += event.delta;
            progress.report(new vscode.LanguageModelTextPart(event.delta));
        });

        if (ThinkingPartCtor) {
            stream.on('response.reasoning_summary_text.delta', (event) => {
                const itemId = this.getStringProp(event, 'item_id');
                if (itemId) {
                    reasoningStreamedIds.add(itemId);
                }
                progress.report(new ThinkingPartCtor(event.delta, itemId));
                thinkingActive = true;
            });
        } else {
            // If the host doesn't expose LanguageModelThinkingPart, the user
            // won't see thinking tokens regardless of backend output. Log once
            // per request so it's obvious from the output channel.
            this.logger.warn(
                'LanguageModelThinkingPart is not available on this VS Code version; ' +
                'reasoning tokens will not be surfaced.'
            );
        }

        const cancellationListener = token.onCancellationRequested(() => {
            stream.abort();
        });

        try {
            const response = await stream.finalResponse();

            for (const item of response.output) {
                if (item.type === 'reasoning') {
                    // Carry reasoning id + (optional) encrypted_content so we can
                    // replay this reasoning item on subsequent turns. If we already
                    // streamed the summary via reasoning_summary_text.delta, emit
                    // empty text here to avoid duplicating it in VS Code's history.
                    if (ThinkingPartCtor) {
                        const alreadyStreamed = reasoningStreamedIds.has(item.id);
                        const summaryText = alreadyStreamed
                            ? ''
                            : (item.summary ?? [])
                                .map(s => s.type === 'summary_text' ? s.text : '')
                                .join('');

                        // Reasoning id + (optional) encrypted_content round-trip for replay.
                        const metadata: Record<string, unknown> = {};
                        if (item.encrypted_content) {
                            metadata.encrypted_content = item.encrypted_content;
                        }
                        // Only stamp the done marker when this *is* the closer
                        // (no new summary text to carry).
                        if (summaryText === '') {
                            metadata.vscode_reasoning_done = true;
                        }

                        progress.report(new ThinkingPartCtor(summaryText, item.id, metadata));

                        // Non-streaming backend path: we just emitted a content-bearing
                        // thinking part, so follow it with an explicit closer to mark
                        // the thinking phase complete (matches Copilot convention).
                        if (summaryText !== '') {
                            progress.report(new ThinkingPartCtor('', '', { vscode_reasoning_done: true }));
                        }

                        thinkingActive = false;
                    }

                    continue;
                }

                if (item.type === 'message') {
                    endThinkingIfActive();

                    const finalText = item.content
                        .map(part => part.type === 'output_text' ? part.text : '')
                        .join('');

                    if (this.isValidText(finalText)) {
                        const itemId = this.getStringProp(item, 'id');
                        const streamedText = (itemId && streamedTextByItem.get(itemId)) || globalStreamedText;

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
                }

                if (item.type === "function_call") {
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

    /**
     * Convert an incoming LanguageModelThinkingPart (proposed API) back into a
     * ResponseReasoningItem so chain-of-thought is preserved across stateless
     * Responses API calls. Returns undefined if the part doesn't carry enough
     * information to be worth replaying.
     */
    private buildReasoningItem(part: unknown): ResponseInputItem | undefined {
        if (!part || typeof part !== 'object') {
            return undefined;
        }

        const obj = part as { value?: unknown; id?: unknown; metadata?: unknown };

        // Without an id the server can't correlate the reasoning item with a
        // prior response, so there's nothing useful to send back.
        const id = typeof obj.id === 'string' ? obj.id : '';
        if (!id) {
            return undefined;
        }

        const rawValue = obj.value;
        const valueText = Array.isArray(rawValue)
            ? rawValue.filter((v): v is string => typeof v === 'string').join('')
            : typeof rawValue === 'string' ? rawValue : '';

        const metadata = (obj.metadata && typeof obj.metadata === 'object')
            ? obj.metadata as Record<string, unknown>
            : undefined;

        const summary = valueText.length > 0
            ? [{ type: 'summary_text' as const, text: valueText }]
            : [];

        const encrypted = metadata?.encrypted_content;
        const encryptedContent = typeof encrypted === 'string' && encrypted.length > 0
            ? encrypted
            : undefined;

        // With neither a summary nor encrypted payload, replaying the item buys
        // us nothing — skip it rather than send an empty reasoning shell.
        if (summary.length === 0 && !encryptedContent) {
            return undefined;
        }

        return {
            type: 'reasoning',
            id,
            summary,
            ...(encryptedContent ? { encrypted_content: encryptedContent } : {}),
        };
    }

    private getStringProp(obj: unknown, key: string): string | undefined {
        if (!obj || typeof obj !== 'object') {
            return undefined;
        }

        const value = (obj as Record<string, unknown>)[key];
        return typeof value === 'string' && value.trim().length > 0 ? value : undefined;
    }
}
