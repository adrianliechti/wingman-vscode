import * as vscode from 'vscode';
import { ChatModelProvider } from "./provider";
import { Bridge } from './bridge';
import { openAgent, getAgentCommand, createStatusBarItem, agentProfileProvider } from './agent';

export async function activate(context: vscode.ExtensionContext) {
	const logger = vscode.window.createOutputChannel('Wingman AI', { log: true });
	const provider = new ChatModelProvider(context, logger);
	const server = new Bridge(logger);

	try {
		const port = await server.start();
		logger.info(`Bridge started on port ${port}`);
	} catch (err) {
		logger.error('Failed to start Bridge:', String(err));
	}

	context.subscriptions.push(
		logger,
		server,
		vscode.lm.registerLanguageModelChatProvider('wingman', provider),
		vscode.commands.registerCommand('wingman.openAgent', openAgent),
		vscode.window.registerTerminalProfileProvider('wingman.agent', agentProfileProvider),
	);

	if (getAgentCommand()) {
		vscode.commands.executeCommand('setContext', 'wingman.agentAvailable', true);
		context.subscriptions.push(createStatusBarItem());
	}
}

export function deactivate() { }
