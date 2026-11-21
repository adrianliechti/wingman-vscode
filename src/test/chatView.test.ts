import * as assert from 'node:assert';
import * as vscode from 'vscode';

import type { FromWebview, ToWebview } from '../chatProtocol';
import { WingmanChatView } from '../chatView';

const extensionUri = vscode.Uri.file('/extensions/wingman');

/** The parts of a webview view the provider uses, with the page played by the test. */
function fakeView() {
	const posted: ToWebview[] = [];
	let receive: (message: FromWebview) => void = () => { };
	const webview = {
		options: {} as vscode.WebviewOptions,
		html: '',
		cspSource: 'https://webview.test',
		asWebviewUri: (uri: vscode.Uri) => vscode.Uri.parse(`https://webview.test${uri.path}`),
		onDidReceiveMessage: (listener: (message: FromWebview) => void) => {
			receive = listener;
			return { dispose() { } };
		},
		postMessage: async (message: ToWebview) => {
			posted.push(message);
			return true;
		},
	};
	const view = { webview, description: undefined as string | undefined, onDidDispose: () => ({ dispose() { } }) };
	return {
		view,
		posted,
		/** Delivers a message from the page and lets the provider handle it. */
		async send(message: FromWebview) {
			receive(message);
			await new Promise(resolve => setImmediate(resolve));
		},
	};
}

suite('Wingman chat view', () => {
	const logger = vscode.window.createOutputChannel('Wingman chat view test', { log: true });
	let started = 0;
	let chat: WingmanChatView;
	setup(() => {
		started = 0;
		chat = new WingmanChatView(extensionUri, logger, async () => { started++; });
	});
	teardown(() => chat.dispose());
	suiteTeardown(() => logger.dispose());

	test('contributes the panel with its commands', async () => {
		await vscode.extensions.getExtension('adrianliechti.wingman-vscode')?.activate();
		const commands = await vscode.commands.getCommands(true);
		// VS Code adds the focus command only for a view whose container it accepted.
		for (const command of ['wingman.chat.focus', 'wingman.openChat', 'wingman.newChat', 'wingman.chatHistory']) {
			assert.ok(commands.includes(command), `${command} is not registered`);
		}
	});

	test('lets the page load the extension\'s own files and reach only the agent host', () => {
		const { view } = fakeView();
		chat.resolveWebviewView(view as unknown as vscode.WebviewView);

		const policy = /http-equiv="Content-Security-Policy" content="([^"]+)"/.exec(view.webview.html)?.[1] ?? '';
		const directives = Object.fromEntries(policy.split('; ').map(directive => {
			const [name, ...sources] = directive.split(' ');
			return [name, sources.join(' ')];
		}));
		const nonce = /^'nonce-([A-Za-z0-9+/=]+)'$/.exec(directives['script-src'])?.[1];
		assert.ok(nonce, 'scripts need the page\'s nonce');
		assert.deepStrictEqual(directives, {
			'default-src': `'none'`,
			'script-src': `'nonce-${nonce}'`,
			'style-src': 'https://webview.test',
			'font-src': 'https://webview.test',
			// No remote images: model output must not make the panel call out.
			'img-src': 'https://webview.test data:',
			'connect-src': 'ws://localhost:9100',
		});
		assert.ok(view.webview.html.includes(`<script nonce="${nonce}" src="https://webview.test/extensions/wingman/out/webview.js"></script>`));
		assert.ok(view.webview.html.includes('<link rel="stylesheet" href="https://webview.test/extensions/wingman/out/webview.css">'));
		assert.strictEqual(view.webview.options.enableScripts, true);
		assert.ok(view.webview.html.includes('<div id="root" data-icon="https://webview.test/extensions/wingman/assets/agent.png">'));
		assert.deepStrictEqual(view.webview.options.localResourceRoots?.map(String), ['out', 'assets'].map(name => vscode.Uri.joinPath(extensionUri, name).toString()));
	});

	test('tells the page where the host is and which folder its sessions work in', async () => {
		const { view, posted, send } = fakeView();
		chat.resolveWebviewView(view as unknown as vscode.WebviewView);
		assert.deepStrictEqual(posted, [], 'nothing is sent before the page listens');

		await send({ type: 'ready' });

		const folder = vscode.workspace.workspaceFolders?.[0];
		const usable = folder?.uri.scheme === 'file' && !vscode.env.remoteName && vscode.workspace.isTrusted;
		assert.strictEqual(posted.length, 1);
		const init = posted[0] as Extract<ToWebview, { type: 'init' }>;
		assert.strictEqual(init.type, 'init');
		assert.strictEqual(init.address, 'ws://localhost:9100/ahp');
		if (usable) {
			assert.deepStrictEqual({ directory: init.directory, notice: init.notice }, { directory: folder.uri.toString(), notice: undefined });
		} else {
			assert.strictEqual(init.directory, undefined, 'no session may start without a trusted local folder');
			assert.ok(init.notice, 'the page says why it cannot chat');
		}
	});

	test('starts the host and shows the session title for the page', async () => {
		const { view, send } = fakeView();
		chat.resolveWebviewView(view as unknown as vscode.WebviewView);
		await send({ type: 'ready' });

		await send({ type: 'startHost' });
		assert.strictEqual(started, 1);

		await send({ type: 'title', title: 'Fix the login test' });
		assert.strictEqual(view.description, 'Fix the login test');
		await send({ type: 'title', title: '' });
		assert.strictEqual(view.description, undefined);
	});
});
