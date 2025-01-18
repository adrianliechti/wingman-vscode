import * as vscode from 'vscode';
import { InlineCompletionProvider } from "./providers/InlineCompletionProvider";

export function activate(context: vscode.ExtensionContext) {
	const inlineCompletionProvider = new InlineCompletionProvider()

	vscode.languages.registerInlineCompletionItemProvider(
		{ pattern: "**" },
		inlineCompletionProvider
	);

	context.subscriptions.push(inlineCompletionProvider);
}

export function deactivate() { }
