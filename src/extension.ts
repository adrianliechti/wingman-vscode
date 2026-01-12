import * as vscode from 'vscode';
import { ChatModelProvider } from "./provider";

export function activate(context: vscode.ExtensionContext) {
	const logger = vscode.window.createOutputChannel('Wingman AI', { log: true });
	const provider = new ChatModelProvider(context, logger);
	
	context.subscriptions.push(
		logger,
		vscode.lm.registerLanguageModelChatProvider('wingman', provider),
	);
}

export function deactivate() { }
