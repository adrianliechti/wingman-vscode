import * as vscode from "vscode";

import type {
	FunctionTool,
	ResponseInputImage,
	ResponseInputItem,
	ResponseInputMessageContentList,
} from "openai/resources/responses/responses";
import type { ReasoningEffort } from "openai/resources/shared";

import { resolveReasoningEffort, type ModelInfo } from "./models";

const validToolNamePattern = /^[\w-]+$/;

interface ResponseStreamRequest {
	model: string;
	input: ResponseInputItem[];
	instructions?: string;
	tools?: FunctionTool[];
	tool_choice?: "auto" | "required";
	parallel_tool_calls?: true;
	reasoning?: { effort: ReasoningEffort; summary: "auto" };
	truncation: "auto";
}

export function buildRequest(
	model: ModelInfo,
	messages: readonly vscode.LanguageModelChatRequestMessage[],
	options: vscode.ProvideLanguageModelChatResponseOptions,
): { request: ResponseStreamRequest; droppedToolCallCount: number } {
	const tools = options.tools?.map(tool => {
		if (!validToolNamePattern.test(tool.name)) {
			throw new Error(`Invalid tool name "${tool.name}": only alphanumeric characters, hyphens, and underscores are allowed.`);
		}

		return {
			type: "function" as const,
			name: tool.name,
			description: tool.description,
			parameters: (tool.inputSchema as Record<string, unknown> | undefined) ?? null,
			strict: false,
		};
	}) ?? [];
	const { input, instructions, droppedToolCallCount } = buildInput(messages);
	const modelId = model.family;
	const configuration = (options as unknown as { modelConfiguration?: Record<string, unknown> }).modelConfiguration;
	const effort = resolveReasoningEffort(modelId, configuration);

	const request: ResponseStreamRequest = {
		model: modelId,
		input,
		truncation: "auto",
	};

	if (instructions) {
		request.instructions = instructions;
	}

	if (tools.length > 0) {
		request.tools = tools;
		request.tool_choice = options.toolMode === vscode.LanguageModelChatToolMode.Required ? "required" : "auto";
		request.parallel_tool_calls = true;
	}

	if (effort) {
		request.reasoning = { effort, summary: "auto" };
	}

	return { request, droppedToolCallCount };
}

function buildInput(messages: readonly vscode.LanguageModelChatRequestMessage[]): {
	input: ResponseInputItem[];
	instructions?: string;
	droppedToolCallCount: number;
} {
	const input: ResponseInputItem[] = [];
	const systemTexts: string[] = [];

	for (const message of messages) {
		if (message.role === vscode.LanguageModelChatMessageRole.User) {
			appendUser(message, input);
		} else if (message.role === vscode.LanguageModelChatMessageRole.Assistant) {
			appendAssistant(message, input);
		} else {
			const text = message.content
				.filter((part): part is vscode.LanguageModelTextPart => part instanceof vscode.LanguageModelTextPart)
				.map(part => part.value)
				.join("");
			if (isNonEmpty(text)) {
				systemTexts.push(text);
			}
		}
	}

	const { input: sanitizedInput, droppedToolCallCount } = pruneTools(input);

	return {
		input: sanitizedInput,
		instructions: systemTexts.join("\n\n") || undefined,
		droppedToolCallCount,
	};
}

function appendUser(message: vscode.LanguageModelChatRequestMessage, input: ResponseInputItem[]): void {
	let content: ResponseInputMessageContentList = [];

	const flushContent = () => {
		if (content.length > 0) {
			input.push({ role: "user", content });
			content = [];
		}
	};

	for (const part of message.content) {
		if (part instanceof vscode.LanguageModelToolResultPart) {
			flushContent();
			input.push({
				type: "function_call_output",
				call_id: part.callId,
				output: part.content.map(toOutputText).join(""),
			});
		} else if (part instanceof vscode.LanguageModelTextPart && isNonEmpty(part.value)) {
			content.push({ type: "input_text", text: part.value });
		} else if (part instanceof vscode.LanguageModelDataPart) {
			const image = toImage(part);
			if (image) {
				content.push(image);
			}
		}
	}

	flushContent();
}

function appendAssistant(message: vscode.LanguageModelChatRequestMessage, input: ResponseInputItem[]): void {
	let text = "";

	const flushText = () => {
		if (isNonEmpty(text)) {
			input.push({ role: "assistant", content: text });
		}
		text = "";
	};

	for (const part of message.content) {
		if (part instanceof vscode.LanguageModelTextPart) {
			text += part.value;
		} else if (part instanceof vscode.LanguageModelToolCallPart) {
			flushText();
			input.push({
				type: "function_call",
				call_id: part.callId,
				name: part.name,
				arguments: JSON.stringify(part.input),
			});
		}
	}

	flushText();
}

function toOutputText(part: unknown): string {
	if (part instanceof vscode.LanguageModelTextPart) {
		return part.value;
	}

	if (typeof part === "string") {
		return part;
	}

	if (part instanceof vscode.LanguageModelDataPart) {
		if (part.mimeType.startsWith("text/") || part.mimeType === "application/json") {
			return new TextDecoder().decode(part.data);
		}
		return "";
	}

	if (part && typeof part === "object" && "mimeType" in part && "data" in part) {
		return "";
	}

	try {
		return JSON.stringify(part) ?? "";
	} catch {
		return "";
	}
}

function toImage(part: vscode.LanguageModelDataPart): ResponseInputImage | undefined {
	if (!part.mimeType.startsWith("image/")) {
		return undefined;
	}

	return {
		type: "input_image",
		image_url: `data:${part.mimeType};base64,${Buffer.from(part.data).toString("base64")}`,
		detail: "auto",
	};
}

function pruneTools(input: ResponseInputItem[]): { input: ResponseInputItem[]; droppedToolCallCount: number } {
	const completedCallIds = new Set<string>();

	for (const item of input) {
		const typedItem = item as { type?: string; call_id?: unknown };
		if (typedItem.type === "function_call_output" && typeof typedItem.call_id === "string") {
			completedCallIds.add(typedItem.call_id);
		}
	}

	const sanitizedInput = input.filter(item => {
		const typedItem = item as { type?: string; call_id?: unknown };
		return typedItem.type !== "function_call" ||
			(typeof typedItem.call_id === "string" && completedCallIds.has(typedItem.call_id));
	});

	return {
		input: sanitizedInput,
		droppedToolCallCount: input.length - sanitizedInput.length,
	};
}

function isNonEmpty(value: string): boolean {
	return value.trim().length > 0;
}
