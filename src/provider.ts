import * as vscode from "vscode";

import OpenAI from 'openai';
import { ChatCompletionContentPartText, ChatCompletionMessageParam, ChatCompletionMessageToolCall, ChatCompletionTool, ChatCompletionToolChoiceOption } from "openai/resources/chat/completions";

export class ChatModelProvider implements vscode.LanguageModelChatProvider {
    constructor() {
    }

    async provideLanguageModelChatInformation(options: vscode.PrepareLanguageModelChatModelOptions, token: vscode.CancellationToken): Promise<vscode.LanguageModelChatInformation[]> {
        const client = await this.createClient();

        const list = await client.models.list();

        const findModel = (...candidates: string[]): string => {
            const models = list.data.map(model => model.id);
            return candidates.find(model => models.includes(model)) || "";
        };

        const mainModel = findModel('gpt-5-codex', 'gpt-5', 'o3');
        const miniModel = findModel('gpt-5-codex-mini', 'gpt-5-mini', 'o4-mini');

        // https://github.com/microsoft/vscode-copilot-chat/blob/main/src/extension/byok/common/byokProvider.ts
        const maxInputTokens = 200000; // 100000 (Default), 272000 (GPT-5)
        const maxOutputTokens = 32000; // 8192 (Default),   128000 (GPT-5)

        const results: vscode.LanguageModelChatInformation[] = [];

        if (mainModel) {
            results.push({
                id: mainModel,

                name: "Wingman Coder",

                family: mainModel,
                version: "",

                maxInputTokens: maxInputTokens,
                maxOutputTokens: maxOutputTokens,

                capabilities: {
                    toolCalling: true,
                    imageInput: true,
                },
            });
        }

        if (miniModel) {
            results.push({
                id: miniModel,

                name: "Wingman Coder Mini",

                family: miniModel,
                version: "",

                maxInputTokens: maxInputTokens,
                maxOutputTokens: maxOutputTokens,

                capabilities: {
                    toolCalling: true,
                    imageInput: true,
                },
            });
        }

        return results;
    }

    async provideTokenCount(model: vscode.LanguageModelChatInformation, text: string | vscode.LanguageModelChatRequestMessage, token: vscode.CancellationToken): Promise<number> {
        if (typeof text === "string") {
            return Math.ceil(text.length / 4);
        }

        const json = JSON.stringify(text);
        return Math.ceil(json.length / 4);
    }

    async provideLanguageModelChatResponse(model: vscode.LanguageModelChatInformation, messages: readonly vscode.LanguageModelChatRequestMessage[], options: vscode.ProvideLanguageModelChatResponseOptions, progress: vscode.Progress<vscode.LanguageModelResponsePart>, token: vscode.CancellationToken): Promise<void> {
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
            if (message.role === vscode.LanguageModelChatMessageRole.User) {
                const textParts: Array<ChatCompletionContentPartText> = [];

                for (const part of message.content) {
                    if (part instanceof vscode.LanguageModelTextPart) {
                        if (part.value.trim() && part.value.trim().toLowerCase() !== 'undefined') {
                            textParts.push({
                                type: "text",

                                text: part.value
                            });
                        }
                    }

                    //if (part instanceof vscode.LanguageModelToolResultPart) {
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

                if (textParts.length > 0) {
                    input.push({
                        role: "assistant",
                        content: textParts
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

                if (textParts.length > 0) {
                    input.push({
                        role: "assistant",
                        content: textParts
                    });
                }

                if (toolCalls.length > 0) {
                    input.push({
                        role: "assistant",
                        tool_calls: toolCalls
                    });
                }
            }
        }

        const runner = client.chat.completions.stream({
            model: model.id,

            tools: tools,
            tool_choice: options.toolMode === vscode.LanguageModelChatToolMode.Required ? 'required' : 'auto',

            messages: input,
        })
            .on('content', (diff) => {
                progress.report(new vscode.LanguageModelTextPart(diff));
            });

        const completion = await runner.finalChatCompletion();
        const result = completion.choices[0].message;

        result.tool_calls?.forEach(toolCall => {
            if (toolCall.type === "function" && toolCall.id && toolCall.function) {
                progress.report(new vscode.LanguageModelToolCallPart(
                    toolCall.id,
                    toolCall.function.name || '',
                    JSON.parse(toolCall.function.arguments || '{}')
                ));
            }
        });
    }

    private async createClient(): Promise<OpenAI> {
        const config = vscode.workspace.getConfiguration('wingman');

        const baseUrl = config.get<string>('baseUrl', 'http://localhost:4242/v1');
        const apiKey = config.get<string>('apiKey', '');

        return new OpenAI({
            baseURL: baseUrl,
            apiKey: apiKey,

            organization: null,
            project: null,
            webhookSecret: null
        });
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