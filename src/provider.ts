import * as vscode from "vscode";

import OpenAI from 'openai';
import { ChatCompletionMessageParam, ChatCompletionTool } from "openai/resources/chat/completions";

export class ChatModelProvider implements vscode.LanguageModelChatProvider {
    constructor(private readonly secrets: vscode.SecretStorage) {
    }

    async provideLanguageModelChatInformation(options: vscode.PrepareLanguageModelChatModelOptions, token: vscode.CancellationToken): Promise<vscode.LanguageModelChatInformation[]> {
        const apiKey = await this.ensureAPIKey(options.silent);
        const baseUrl = await this.ensureBaseUrl(options.silent);
		
        if (!apiKey || !baseUrl) {
			return [];
		}

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
                for (const part of message.content) {
                    if (part instanceof vscode.LanguageModelTextPart) {
                        if (!part.value.trim() || part.value.trim().toLowerCase() === 'undefined') {
                            continue;
                        }

                        input.push({
                            role: "user",
                            content: part.value
                        });
                    }

                    if (part instanceof vscode.LanguageModelToolResultPart) {
                        input.push({
                            role: "tool",
                            tool_call_id: part.callId,
                            content: part.content
                                .filter(p => p instanceof vscode.LanguageModelTextPart || p instanceof vscode.LanguageModelPromptTsxPart)
                                .map(p => {
                                    if (p instanceof vscode.LanguageModelTextPart) {
                                        return p.value;
                                    }

                                    if (p instanceof vscode.LanguageModelPromptTsxPart) {
                                        return p.value;
                                    }

                                    return '';
                                })
                                .join('')
                        });
                    }
                }
            }

            if (message.role === vscode.LanguageModelChatMessageRole.Assistant) {
                for (const part of message.content) {
                    if (part instanceof vscode.LanguageModelTextPart) {
                        if (!part.value.trim() || part.value.trim().toLowerCase() === 'undefined') {
                            continue;
                        }

                        input.push({
                            role: "assistant",
                            content: part.value
                        });
                    }

                    if (part instanceof vscode.LanguageModelToolCallPart) {
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
        
        const runner = client.chat.completions.stream({
            model: model.id,

            tools: tools,
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
        const baseURL = await this.ensureBaseUrl(true);
        const apiKey = await this.ensureAPIKey(true);

        if (!baseURL || !apiKey) {
            throw new Error("Missing API key or Base URL");
        }

        return new OpenAI({
            baseURL: baseURL,
            apiKey: apiKey
        });
    }

    private async ensureBaseUrl(silent: boolean): Promise<string | undefined> {
		let baseUrl = await this.secrets.get("wingman.baseUrl");

		if (!baseUrl && !silent) {
			const entered = await vscode.window.showInputBox({
				title: "Wingman Base Url",
				prompt: "Enter Wingman Base Url",
				ignoreFocusOut: true,
				password: false,
                value: "http://localhost:8080/v1",
			});

			if (entered && entered.trim()) {
				baseUrl = entered.trim();
				await this.secrets.store("wingman.baseUrl", baseUrl);
			}
		}

		return baseUrl;
	}

    private async ensureAPIKey(silent: boolean): Promise<string | undefined> {
		let apiKey = await this.secrets.get("wingman.apiKey");

		if (!apiKey && !silent) {
			const entered = await vscode.window.showInputBox({
				title: "Wingman API Key",
				prompt: "Enter Wingman API key",
				ignoreFocusOut: true,
				password: true,
                value: "-"
			});

			if (entered && entered.trim()) {
				apiKey = entered.trim();
				await this.secrets.store("wingman.apiKey", apiKey);
			}
		}

		return apiKey;
	}
}