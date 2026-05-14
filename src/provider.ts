import * as vscode from "vscode";

import OpenAI from 'openai';

import { toAvailableModelInfos, type ModelInfo } from "./models";
import { buildRequest } from "./responses";

export class ChatModelProvider implements vscode.LanguageModelChatProvider<ModelInfo> {
    private client?: OpenAI;

    private readonly modelInfoChangeEmitter = new vscode.EventEmitter<void>();
    private readonly logger: vscode.LogOutputChannel;

    readonly onDidChangeLanguageModelChatInformation = this.modelInfoChangeEmitter.event;

    constructor(context: vscode.ExtensionContext, logger: vscode.LogOutputChannel) {
        this.logger = logger;

        context.subscriptions.push(
            this.modelInfoChangeEmitter,
            vscode.workspace.onDidChangeConfiguration(e => {
                if (e.affectsConfiguration('wingman')) {
                    this.client = undefined;
                    this.modelInfoChangeEmitter.fire();
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
        const modelIds = (await client.models.list()).data.map(model => model.id);

        if (token.isCancellationRequested) {
            return [];
        }

        const results = toAvailableModelInfos(modelIds);

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

        const ThinkingPartCtor = (vscode as Record<string, unknown>)['LanguageModelThinkingPart'] as
            (new (value: string, id?: string, metadata?: { readonly [key: string]: unknown }) => vscode.LanguageModelResponsePart) | undefined;

        const { request, droppedToolCallCount } = buildRequest(model, messages, options);
        if (droppedToolCallCount > 0) {
            this.logger.warn(`Dropped ${droppedToolCallCount} orphan tool call(s) before request.`);
        }

        const stream = client.responses.stream(request);

        // Wire the abort listener before any awaits so a cancellation arriving
        // during stream startup is caught. If we were already cancelled by the
        // time the stream existed, abort immediately.
        const cancellationListener = token.onCancellationRequested(() => {
            stream.abort();
        });
        if (token.isCancellationRequested) {
            stream.abort();
        }

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
                    if (finalText.trim().length > 0) {
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
        if (this.client) {
            return this.client;
        }

        const config = vscode.workspace.getConfiguration('wingman');
        const baseUrl = config.get<string>('baseUrl', 'http://localhost:4242/v1');
        const apiKey = config.get<string>('apiKey', '-');

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
}
