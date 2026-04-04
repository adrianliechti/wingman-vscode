import * as vscode from 'vscode';
import { ChatModelProvider } from "./provider";
import { Bridge } from './bridge';

export async function activate(context: vscode.ExtensionContext) {
	const logger = vscode.window.createOutputChannel('Wingman AI', { log: true });
	const provider = new ChatModelProvider(context, logger);
	const server = new Bridge(logger);

	try {
		const port = await server.start();
		logger.info(`IDE bridge started on port ${port}`);
	} catch (err) {
		logger.error('Failed to start IDE bridge:', String(err));
	}

	context.subscriptions.push(
		logger,
		server,
		vscode.lm.registerLanguageModelChatProvider('wingman', provider),
	);
}

export function deactivate() { }
