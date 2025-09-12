import * as vscode from "vscode";
import {
    Progress,
    CancellationToken,
    SecretStorage,
    LanguageModelChatProvider,
    LanguageModelChatInformation,
    LanguageModelChatRequestMessage,
    ProvideLanguageModelChatResponseOptions,
    LanguageModelResponsePart,
    LanguageModelTextPart,
    LanguageModelToolResultPart,
    LanguageModelToolCallPart,
    LanguageModelPromptTsxPart,
    LanguageModelChatMessageRole
} from "vscode";

import OpenAI from 'openai';
import { ChatCompletionMessageParam, ChatCompletionContentPartText, ChatCompletionTool } from "openai/resources/chat/completions";

export class ChatModelProvider implements LanguageModelChatProvider {
    private _client: OpenAI;

    constructor(private readonly secrets: SecretStorage) {
        this._client = new OpenAI({
            baseURL: 'http://localhost:8080/v1',
            apiKey: '-'
        });
    }

    //onDidChangeLanguageModelChatInformation?: vscode.Event<void> | undefined;

    async provideLanguageModelChatInformation(options: vscode.PrepareLanguageModelChatModelOptions, token: vscode.CancellationToken): Promise<LanguageModelChatInformation[]> {
        return [{
            id: "gpt-5",

            name: "Wingman Coder",

            family: "gpt5",

            version: "1",

            maxInputTokens: 128000,
            maxOutputTokens: 400000,

            capabilities: {
                toolCalling: true,
                imageInput: true,
            },
        }];
    }

    async provideTokenCount(model: LanguageModelChatInformation, text: string | LanguageModelChatRequestMessage, token: CancellationToken): Promise<number> {
        return 0;
    }

    async provideLanguageModelChatResponse(model: LanguageModelChatInformation, messages: readonly LanguageModelChatRequestMessage[], options: ProvideLanguageModelChatResponseOptions, progress: Progress<LanguageModelResponsePart>, token: CancellationToken): Promise<void> {
        for (const message of messages) {
            for (const part of message.content) {
                if (part instanceof LanguageModelTextPart) {
                    console.log(part.value);
                }
            }
        }

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
            if (message.role === LanguageModelChatMessageRole.User) {
                for (const part of message.content) {
                    if (part instanceof LanguageModelTextPart) {
                        if (part.value.trim() === '') {
                            continue;
                        }

                        input.push({
                            role: "user",
                            content: part.value
                        });
                    }

                    if (part instanceof LanguageModelToolResultPart) {
                        input.push({
                            role: "tool",
                            tool_call_id: part.callId,
                            content: part.content
                                .filter(p => p instanceof LanguageModelTextPart || p instanceof LanguageModelPromptTsxPart)
                                .map(p => {
                                    if (p instanceof LanguageModelTextPart) {
                                        return p.value;
                                    }

                                    if (p instanceof LanguageModelPromptTsxPart) {
                                        return p.value;
                                    }

                                    return '';
                                })
                                .join('')
                        });
                    }
                }
            }

            if (message.role === LanguageModelChatMessageRole.Assistant) {
                for (const part of message.content) {
                    if (part instanceof LanguageModelTextPart) {
                        if (part.value.trim() === '') {
                            continue;
                        }

                        input.push({
                            role: "assistant",
                            content: part.value
                        });
                    }

                    if (part instanceof LanguageModelToolCallPart) {
                        input.push({
                            role: "assistant",
                            tool_calls: [{
                                id: part.callId,
                                type: "function",

                                function: {
                                    name: part.name,
                                    arguments: JSON.stringify(part.input)
                                }
                            }]
                        });
                    }
                }
            }
        }

        const completion = await this._client.chat.completions.create({
            model: model.id,

            tools: tools,
            messages: input,
        });

        const result = completion.choices[0].message;

        if (result.content?.trim() !== '') {
            progress.report(new LanguageModelTextPart(result.content!));
        }

        for (const toolCall of result.tool_calls ?? []) {
            if (toolCall.type === "function") {
                progress.report(new LanguageModelToolCallPart(toolCall.id!, toolCall.function!.name ?? '', JSON.parse(toolCall.function!.arguments || '')));
            }
        }
    }
}