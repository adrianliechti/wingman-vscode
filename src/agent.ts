import * as vscode from 'vscode';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';

const wingmanHome = path.join(os.homedir(), '.wingman');
const wingmanPathFile = path.join(wingmanHome, 'path');

export function getAgentPath(): string | undefined {
	if (!fs.existsSync(wingmanPathFile)) {
		return undefined;
	}

	const agentPath = fs.readFileSync(wingmanPathFile, 'utf-8').trim();

	if (!agentPath || !fs.existsSync(agentPath)) {
		return undefined;
	}

	return agentPath;
}

export class AgentViewProvider implements vscode.WebviewViewProvider {
	resolveWebviewView() {
		openAgent();
	}
}

let agentTerminal: vscode.Terminal | undefined;

export function openAgent() {
	const agentPath = getAgentPath();

	if (!agentPath) {
		vscode.window.showErrorMessage('Wingman Agent not found. Ensure ~/.wingman/path exists and points to a valid executable.');
		return;
	}

	if (agentTerminal && !agentTerminal.exitStatus) {
		agentTerminal.show();
		return;
	}

	agentTerminal = vscode.window.createTerminal({
		name: 'Wingman Agent',
		shellPath: agentPath,
		iconPath: new vscode.ThemeIcon('rocket'),
		location: vscode.TerminalLocation.Panel,
	});

	agentTerminal.show();
}
