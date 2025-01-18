import * as vscode from 'vscode';
import { InlineCompletionProvider } from "./providers/InlineCompletionProvider";

export function activate(context: vscode.ExtensionContext) {
	const inlineCompletionProvider = new InlineCompletionProvider()

	context.subscriptions.push(vscode.languages.registerInlineCompletionItemProvider(
		{ pattern: "**" },
		inlineCompletionProvider
	));
}

export function deactivate() { }
