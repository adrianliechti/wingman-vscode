import * as vscode from 'vscode';
import { randomBytes } from 'node:crypto';

import { hostAddress } from './agentHost';
import type { FromWebview, SessionItem, ToWebview } from './chatProtocol';

export const chatViewId = 'wingman.chat';

type SessionPick = vscode.QuickPickItem & { uri: string };

/**
 * The chat panel. Its webview connects to the shared agent host itself, so
 * this side only supplies the workspace folder and opens files and links.
 */
export class WingmanChatView implements vscode.WebviewViewProvider, vscode.Disposable {
	private view?: vscode.WebviewView;
	private ready = false;
	private queued: ToWebview[] = [];
	private sessions?: (reply: Extract<FromWebview, { type: 'sessions' }>) => void;
	private readonly listeners: vscode.Disposable[];

	constructor(
		private readonly extensionUri: vscode.Uri,
		private readonly logger: vscode.LogOutputChannel,
		private readonly startHost: () => Promise<void>,
	) {
		// Sessions run in the window's folder, so the panel follows it.
		const update = () => { if (this.ready) { this.post(this.init()); } };
		this.listeners = [
			vscode.workspace.onDidChangeWorkspaceFolders(update),
			vscode.workspace.onDidGrantWorkspaceTrust(update),
		];
	}

	dispose(): void {
		for (const listener of this.listeners) {
			listener.dispose();
		}
	}

	resolveWebviewView(view: vscode.WebviewView): void {
		const roots = [vscode.Uri.joinPath(this.extensionUri, 'out'), vscode.Uri.joinPath(this.extensionUri, 'assets')];
		this.view = view;
		this.ready = false;
		view.webview.options = { enableScripts: true, localResourceRoots: roots };
		view.webview.onDidReceiveMessage((message: FromWebview) => { void this.receive(message); });
		view.onDidDispose(() => {
			if (this.view === view) {
				this.view = undefined;
				this.ready = false;
			}
		});
		view.webview.html = html(view.webview, this.extensionUri);
	}

	async newChat(): Promise<void> {
		await this.reveal();
		this.post({ type: 'newChat' });
	}

	/** Lists the folder's sessions, which only the webview's connection can read. */
	async showHistory(): Promise<void> {
		await this.reveal();
		const picker = vscode.window.createQuickPick<SessionPick>();
		picker.placeholder = 'Open a Wingman session';
		picker.matchOnDescription = true;
		picker.busy = true;
		picker.show();
		const closed = new Promise<undefined>(resolve => picker.onDidHide(() => resolve(undefined)));
		try {
			const reply = await Promise.race([this.listSessions(), closed]);
			if (!reply) {
				return;
			}
			if (reply.error) {
				picker.hide();
				void vscode.window.showWarningMessage(`Wingman: could not list sessions — ${reply.error}`);
				return;
			}
			picker.busy = false;
			picker.placeholder = reply.items.length ? 'Open a Wingman session' : 'No sessions in this folder yet';
			picker.items = reply.items.map(toPick);
			picker.activeItems = picker.items.filter(item => item.picked);
			const picked = await Promise.race([
				new Promise<SessionPick | undefined>(resolve => picker.onDidAccept(() => resolve(picker.selectedItems[0]))),
				closed,
			]);
			if (picked) {
				this.post({ type: 'openSession', uri: picked.uri });
			}
		} finally {
			picker.dispose();
		}
	}

	private async reveal(): Promise<void> {
		await vscode.commands.executeCommand(`${chatViewId}.focus`);
	}

	private listSessions(): Promise<Extract<FromWebview, { type: 'sessions' }>> {
		return new Promise(resolve => {
			const timeout = setTimeout(() => finish({ type: 'sessions', items: [], error: 'the chat panel did not answer' }), 15_000);
			const finish = (reply: Extract<FromWebview, { type: 'sessions' }>) => {
				clearTimeout(timeout);
				if (this.sessions === finish) {
					this.sessions = undefined;
				}
				resolve(reply);
			};
			// A newer request replaces an unanswered one.
			this.sessions?.({ type: 'sessions', items: [] });
			this.sessions = finish;
			this.post({ type: 'listSessions' });
		});
	}

	private init(): ToWebview {
		const folder = vscode.workspace.workspaceFolders?.[0];
		// The host runs on this machine and opens local folders only.
		const notice = vscode.env.remoteName || folder && folder.uri.scheme !== 'file'
			? 'Remote workspaces are not supported yet. Open a local folder to chat with Wingman.'
			: !folder
				? 'Open a folder to chat with Wingman.'
				: !vscode.workspace.isTrusted
					? 'Trust this workspace to chat with Wingman.'
					: undefined;
		return { type: 'init', address: hostAddress, ...(notice ? { notice } : { directory: folder?.uri.toString() }) };
	}

	/** Messages wait for the webview's script, which loads after the view is created. */
	private post(message: ToWebview): void {
		if (this.ready && this.view) {
			void this.view.webview.postMessage(message);
		} else {
			this.queued.push(message);
		}
	}

	private async receive(message: FromWebview): Promise<void> {
		switch (message.type) {
			case 'ready': {
				this.ready = true;
				const queued = this.queued;
				this.queued = [];
				for (const next of [this.init(), ...queued]) {
					this.post(next);
				}
				break;
			}
			case 'startHost':
				await this.startHost();
				break;
			case 'sessions':
				this.sessions?.(message);
				break;
			case 'title':
				if (this.view) {
					this.view.description = message.title || undefined;
				}
				break;
			case 'openFile':
				await this.openFile(message.uri, message.line);
				break;
			case 'openLink':
				// The transcript is model output: only web links leave the editor.
				if (/^https?:\/\//i.test(message.url)) {
					await vscode.env.openExternal(vscode.Uri.parse(message.url, true));
				}
				break;
		}
	}

	private async openFile(value: string, line?: number): Promise<void> {
		try {
			const uri = vscode.Uri.parse(value, true);
			if (uri.scheme !== 'file') {
				return;
			}
			const position = line && line > 0 ? new vscode.Position(line - 1, 0) : undefined;
			await vscode.window.showTextDocument(uri, {
				preview: true,
				selection: position ? new vscode.Range(position, position) : undefined,
			});
		} catch (error) {
			this.logger.warn('Could not open', value, error instanceof Error ? error.message : String(error));
		}
	}
}

function toPick(item: SessionItem): SessionPick {
	return {
		uri: item.uri,
		label: `${item.running ? '$(loading~spin) ' : ''}${item.title || 'Untitled session'}`,
		description: [item.current ? 'current' : '', ago(item.modifiedAt)].filter(Boolean).join(' · '),
		picked: item.current,
	};
}

function ago(timestamp: string): string {
	const seconds = (Date.now() - Date.parse(timestamp)) / 1000;
	if (!Number.isFinite(seconds)) {
		return '';
	}
	if (seconds < 60) {
		return 'just now';
	}
	for (const [unit, size, limit] of [['minute', 60, 3600], ['hour', 3600, 86_400], ['day', 86_400, 30 * 86_400]] as const) {
		if (seconds < limit) {
			const count = Math.floor(seconds / size);
			return `${count} ${unit}${count === 1 ? '' : 's'} ago`;
		}
	}
	return new Date(timestamp).toLocaleDateString();
}

function html(webview: vscode.Webview, extensionUri: vscode.Uri): string {
	const nonce = randomBytes(16).toString('base64');
	const script = webview.asWebviewUri(vscode.Uri.joinPath(extensionUri, 'out', 'webview.js'));
	const style = webview.asWebviewUri(vscode.Uri.joinPath(extensionUri, 'out', 'webview.css'));
	// The Wingman agent's own icon, as its web UI shows it.
	const icon = webview.asWebviewUri(vscode.Uri.joinPath(extensionUri, 'assets', 'agent.png'));
	// Scripts and styles come from the extension only, and the page may reach
	// nothing but the local agent host. Remote images stay blocked, so model
	// output cannot make the panel call out.
	const policy = [
		`default-src 'none'`,
		`script-src 'nonce-${nonce}'`,
		`style-src ${webview.cspSource}`,
		`font-src ${webview.cspSource}`,
		`img-src ${webview.cspSource} data:`,
		`connect-src ${new URL(hostAddress).origin}`,
	].join('; ');
	return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta http-equiv="Content-Security-Policy" content="${policy}">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<link rel="stylesheet" href="${style}">
<title>Wingman</title>
</head>
<body>
<div id="root" data-icon="${icon}"></div>
<script nonce="${nonce}" src="${script}"></script>
</body>
</html>`;
}
