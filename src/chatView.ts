import * as vscode from 'vscode';
import { randomBytes } from 'node:crypto';

import { hostAddress, supportsManagedHost } from './agentHost';
import type { FileSearch, FromWebview, SessionItem, ToWebview } from './chatProtocol';
import { editorAttachment, editorReference, findWorkspaceFiles } from './fileContext';

export const chatViewId = 'wingman.chat';

type SessionPick = vscode.QuickPickItem & { uri?: string };
type History = { requestId: number, picker: vscode.QuickPick<SessionPick>, timeout: ReturnType<typeof setTimeout> };

/**
 * The chat panel. Its webview connects to the shared agent host itself, so
 * this side supplies workspace and editor context and opens files and links.
 */
export class WingmanChatView implements vscode.WebviewViewProvider, vscode.Disposable {
	private view?: vscode.WebviewView;
	private ready = false;
	private queued: ToWebview[] = [];
	private history?: History;
	private session?: Extract<FromWebview, { type: 'title' }>['session'];
	private fileSearch?: vscode.CancellationTokenSource;
	private requestId = 0;
	private readonly listeners: vscode.Disposable[];

	constructor(
		private readonly extensionUri: vscode.Uri,
		private readonly logger: vscode.LogOutputChannel,
		private readonly startHost: () => Promise<void>,
	) {
		// Sessions run in the window's folder, so the panel follows it.
		const update = () => {
			this.closeHistory();
			this.fileSearch?.cancel();
			if (this.ready) {
				this.post(this.init());
			}
		};
		this.listeners = [
			vscode.workspace.onDidChangeWorkspaceFolders(update),
			vscode.workspace.onDidGrantWorkspaceTrust(update),
		];
	}

	dispose(): void {
		this.closeHistory();
		this.fileSearch?.cancel();
		this.view = undefined;
		this.queued = [];
		for (const listener of this.listeners) {
			listener.dispose();
		}
	}

	resolveWebviewView(view: vscode.WebviewView): void {
		const roots = [vscode.Uri.joinPath(this.extensionUri, 'out'), vscode.Uri.joinPath(this.extensionUri, 'assets')];
		this.view = view;
		this.ready = false;
		view.webview.options = { enableScripts: true, localResourceRoots: roots };
		view.webview.onDidReceiveMessage((message: FromWebview) => {
			if (this.view === view) {
				void this.receive(message).catch(error => this.logger.warn('Wingman panel:', error));
			}
		});
		view.onDidDispose(() => {
			if (this.view === view) {
				this.view = undefined;
				this.ready = false;
				this.session = undefined;
				this.fileSearch?.cancel();
				this.closeHistory();
			}
		});
		view.webview.html = html(view.webview, this.extensionUri);
	}

	async newChat(): Promise<void> {
		await this.reveal();
		this.post({ type: 'newChat' });
	}

	async renameSession(): Promise<void> {
		await this.reveal();
		const session = this.session;
		if (!session) {
			void vscode.window.showInformationMessage('Open a Wingman session to rename it.');
			return;
		}
		const title = (await vscode.window.showInputBox({
			prompt: 'Rename Wingman session',
			value: session.title,
			validateInput: value => value.trim() ? undefined : 'Enter a session name.',
		}))?.trim();
		if (title && title !== session.title && this.session?.uri === session.uri) {
			this.post({ type: 'renameSession', uri: session.uri, title });
		}
	}

	/** Lists the folder's sessions, which only the webview's connection can read. */
	async showHistory(): Promise<void> {
		await this.reveal();
		this.closeHistory();
		const picker = vscode.window.createQuickPick<SessionPick>();
		picker.title = 'Wingman Chat History';
		picker.placeholder = 'Search sessions by title or status';
		picker.matchOnDescription = true;
		picker.busy = true;
		const requestId = ++this.requestId;
		const timeout = setTimeout(() => this.showSessions({ type: 'sessions', requestId, items: [], error: 'the chat panel did not answer' }), 15_000);
		this.history = { requestId, timeout, picker };
		picker.onDidHide(() => this.closeHistory(requestId));
		picker.onDidAccept(() => {
			const picked = picker.selectedItems[0];
			if (this.history?.requestId === requestId && picked?.uri) {
				this.closeHistory(requestId);
				this.post({ type: 'openSession', uri: picked.uri });
			}
		});
		picker.show();
		this.post({ type: 'listSessions', requestId });
	}

	private async reveal(): Promise<void> {
		await vscode.commands.executeCommand(`${chatViewId}.focus`);
	}

	private closeHistory(requestId = this.history?.requestId): void {
		const history = this.history;
		if (history && history.requestId === requestId) {
			this.history = undefined;
			clearTimeout(history.timeout);
			this.queued = this.queued.filter(message => message.type !== 'listSessions' || message.requestId !== requestId);
			history.picker.dispose();
		}
	}

	private showSessions(reply: Extract<FromWebview, { type: 'sessions' }>): void {
		const history = this.history;
		if (!history || history.requestId !== reply.requestId) {
			return;
		}
		clearTimeout(history.timeout);
		if (reply.error) {
			this.closeHistory(reply.requestId);
			void vscode.window.showWarningMessage(`Wingman: could not list sessions — ${reply.error}`);
			return;
		}
		const { picker } = history;
		picker.busy = false;
		picker.placeholder = reply.items.length ? 'Search sessions by title or status' : 'No sessions in this folder yet';
		picker.items = sessionPicks(reply.items);
	}

	private async fileContext(message: Extract<FromWebview, { type: 'findFiles' | 'attachEditor' }>): Promise<void> {
		const view = this.view;
		const directory = vscode.workspace.workspaceFolders?.[0];
		const search = message.type === 'findFiles' ? new vscode.CancellationTokenSource() : undefined;
		if (search) {
			this.fileSearch?.cancel();
			this.fileSearch = search;
		}
		const reply = (context: FileSearch, error?: string) => {
			if (this.view === view && !search?.token.isCancellationRequested && vscode.workspace.workspaceFolders?.[0]?.uri.toString() === directory?.uri.toString()) {
				this.post({ type: 'fileContext', requestId: message.requestId, ...context, error });
			}
		};
		try {
			if (!directory || directory.uri.scheme !== 'file' || vscode.env.remoteName || !vscode.workspace.isTrusted) {
				throw new Error('Open a trusted local folder to attach files.');
			}
			if (message.type === 'findFiles') {
				const files = await findWorkspaceFiles(directory, message.query, search?.token);
				const editor = !message.query ? editorReference(directory, vscode.window.activeTextEditor) : undefined;
				reply({ files, editor });
			} else {
				reply({ files: [await editorAttachment(directory, vscode.window.activeTextEditor, message.uri)] });
			}
		} catch (error) {
			reply({ files: [] }, error instanceof Error ? error.message : String(error));
		} finally {
			if (this.fileSearch === search) {
				this.fileSearch = undefined;
			}
			search?.dispose();
		}
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
		return { type: 'init', address: hostAddress, canStartHost: supportsManagedHost(), ...(notice ? { notice } : { directory: folder?.uri.toString() }) };
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
				this.showSessions(message);
				break;
			case 'findFiles':
			case 'attachEditor':
				await this.fileContext(message);
				break;
			case 'title':
				this.session = message.session;
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

function sessionPicks(items: SessionItem[]): SessionPick[] {
	const groups: Record<string, SessionPick[]> = { 'Current Session': [], 'Needs Input': [], Running: [], Recent: [] };
	for (const item of items) {
		const group = item.current ? 'Current Session' : item.waiting ? 'Needs Input' : item.running ? 'Running' : 'Recent';
		groups[group].push({
			uri: item.uri,
			label: item.title || 'Untitled session',
			description: [item.waiting ? 'Needs input' : item.running ? 'Running' : '', ago(item.modifiedAt)].filter(Boolean).join(' · '),
		});
	}
	return Object.entries(groups).flatMap(([label, picks]) => picks.length
		? [{ label, kind: vscode.QuickPickItemKind.Separator }, ...picks]
		: []);
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
