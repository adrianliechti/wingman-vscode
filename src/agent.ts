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

export const agentProfileProvider: vscode.TerminalProfileProvider = {
	provideTerminalProfile() {
		const agentPath = getAgentPath();

		if (!agentPath) {
			return undefined as unknown as vscode.TerminalProfile;
		}

		return new vscode.TerminalProfile({
			name: 'Wingman Agent',
			shellPath: agentPath,
			iconPath: new vscode.ThemeIcon('rocket'),
			env: { WINGMAN_CALLER: 'vscode' },
		});
	}
};

export function createStatusBarItem(): vscode.StatusBarItem {
	const item = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100);
	item.text = '$(rocket)';
	item.tooltip = 'Open Wingman Agent';
	item.command = 'wingman.openAgent';
	item.show();
	return item;
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
		env: { WINGMAN_CALLER: 'vscode' },
	});

	agentTerminal.show();
}
