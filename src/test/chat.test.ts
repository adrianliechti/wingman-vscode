import * as assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { resolve } from 'node:path';
import { runInNewContext } from 'node:vm';
import { buildSync } from 'esbuild';

import type { FileAttachment, ToWebview } from '../chatProtocol';

type Request = { id: number, method: string, params: { channel: string, clientId?: string, clientSeq?: number, action?: { id?: string, message?: { attachments: unknown[] } } } };
type Chat = {
	init(message: Extract<ToWebview, { type: 'init' }>): void;
	getView(): { connected: boolean, opening: boolean, sending: boolean, error?: string, session?: { title: string }, chat?: { resource: string, queuedMessages?: { id: string }[] } };
	newChat(): void;
	reconnect(): void;
	renameSession(uri: string, title: string): Promise<void>;
	send(message: string, files?: FileAttachment[]): Promise<boolean>;
};

const root = 'ahp-root://';
const directory = 'file:///project';
const address = 'ws://localhost:9100/ahp';
const flush = () => new Promise(resolve => setImmediate(resolve));

suite('Wingman chat client', () => {
	let source: string;
	suiteSetup(() => {
		source = buildSync({
			entryPoints: [resolve(__dirname, '../../src/webview/chat.ts')],
			bundle: true,
			platform: 'browser',
			format: 'cjs',
			write: false,
		}).outputFiles[0].text;
	});

	function fixture() {
		const sockets: Socket[] = [];
		class Socket extends EventTarget {
			readonly OPEN = 1;
			readyState = 0;
			requests: Request[] = [];
			constructor() {
				super();
				sockets.push(this);
				queueMicrotask(() => {
					this.readyState = this.OPEN;
					this.dispatchEvent(new Event('open'));
				});
			}
			send(data: string) {
				const request: Request = JSON.parse(data);
				this.requests.push(request);
				if (request.method === 'initialize') {
					this.reply(request, { snapshots: [{ resource: root, fromSeq: 0, state: { agents: [{ provider: 'wingman' }] } }] });
				} else if (request.method === 'resolveSessionConfig') {
					this.reply(request, { schema: { properties: {} }, values: {} });
				}
			}
			close() {
				this.readyState = 3;
				this.dispatchEvent(Object.assign(new Event('close'), { code: 1000, wasClean: true }));
			}
			request(method: string, channel?: string): Request {
				const request = this.requests.find(request => request.method === method && (!channel || request.params.channel === channel));
				assert.ok(request, `Expected ${method} for ${channel ?? 'any channel'}`);
				return request;
			}
			message(body: object) {
				this.dispatchEvent(Object.assign(new Event('message'), { data: JSON.stringify({ jsonrpc: '2.0', ...body }) }));
			}
			reply(request: Request, result: object) {
				this.message({ id: request.id, result });
			}
			echo(request: Request, serverSeq: number) {
				const { channel, action, clientSeq } = request.params;
				this.message({ method: 'action', params: {
					channel, action, serverSeq,
					origin: { clientId: this.request('initialize').params.clientId, clientSeq },
				} });
			}
			snapshot(channel: string, state: object, fromSeq = 0) {
				this.reply(this.request('subscribe', channel), { snapshot: { resource: channel, state, fromSeq } });
			}
		}

		let saved: unknown;
		const module = { exports: {} as { Chat: new (storage: { getState(): unknown, setState(state: unknown): void }) => Chat } };
		runInNewContext(source, { module, crypto: { randomUUID }, WebSocket: Socket, setTimeout, clearTimeout, console });
		const chat = new module.exports.Chat({ getState: () => saved, setState: state => { saved = state; } });
		const init = () => chat.init({ type: 'init', address, canStartHost: false, directory });
		const dispose = () => chat.init({ type: 'init', address, canStartHost: false, notice: 'No folder' });
		return { chat, sockets, init, dispose, saved: () => saved as { sessions?: Record<string, string> } };
	}

	test('ignores a first send whose session is created after New Chat', async () => {
		const { chat, sockets, init, dispose, saved } = fixture();
		try {
			init();
			await flush();
			const socket = sockets[0];
			const sent = chat.send('Original draft');
			await flush();
			const create = socket.request('createSession');

			chat.newChat();
			socket.reply(create, {});

			assert.equal(await sent, false);
			assert.equal(chat.getView().sending, false);
			assert.equal(saved().sessions?.[directory], undefined);
			assert.ok(!socket.requests.some(request => request.method === 'subscribe' || request.method === 'dispatchAction'));
		} finally {
			dispose();
		}
	});

	test('releases a first send waiting for a chat snapshot when the folder changes', async () => {
		const { chat, sockets, init, dispose } = fixture();
		try {
			init();
			await flush();
			const socket = sockets[0];
			const sent = chat.send('Message for the old folder');
			await flush();
			const create = socket.request('createSession');
			const session = create.params.channel;
			const channel = session.replace('ahp-session:', 'ahp-chat:');
			socket.reply(create, {});
			await flush();
			socket.snapshot(session, { lifecycle: 'ready', defaultChat: channel, chats: [{ resource: channel }] });
			await flush();
			socket.request('subscribe', channel);

			chat.init({ type: 'init', address, canStartHost: false, directory: 'file:///other-project' });
			assert.equal(await sent, false);
			socket.snapshot(channel, { resource: channel, turns: [] });
			await flush();

			assert.equal(chat.getView().sending, false);
			assert.equal(chat.getView().chat, undefined);
			assert.ok(!socket.requests.some(request => request.method === 'dispatchAction'));
		} finally {
			dispose();
		}
	});

	test('applies action echoes and refreshes both channels before accepting input after a reconnect', async () => {
		const { chat, sockets, init, dispose } = fixture();
		try {
			init();
			await flush();
			const socket = sockets[0];
			const sent = chat.send('Hello from the panel');
			await flush();
			const create = socket.request('createSession');
			const session = create.params.channel;
			const channel = session.replace('ahp-session:', 'ahp-chat:');
			const sessionState = { lifecycle: 'ready', defaultChat: channel, chats: [{ resource: channel }] };
			const chatState = { resource: channel, turns: [] };
			socket.reply(create, {});
			await flush();
			socket.snapshot(session, sessionState);
			await flush();
			socket.snapshot(channel, chatState);
			await flush();
			const dispatch = socket.request('dispatchAction', channel);
			socket.echo(dispatch, 1);
			assert.equal(await sent, true);
			assert.equal(chat.getView().chat?.queuedMessages?.[0].id, dispatch.params.action?.id);

			socket.close();
			await flush();
			assert.equal(chat.getView().connected, false);
			chat.reconnect();
			await flush();
			const reconnected = sockets[1];
			reconnected.snapshot(channel, chatState, 1);
			await flush();
			assert.equal(chat.getView().opening, true);
			assert.equal(await chat.send('Wait for the session snapshot'), false);
			reconnected.snapshot(session, sessionState, 1);
			await flush();

			assert.equal(chat.getView().opening, false);
			assert.equal(chat.getView().chat?.resource, channel);
			assert.equal(chat.getView().chat?.queuedMessages, undefined);
		} finally {
			dispose();
		}
	});

	test('sends resource and snapshot attachments and renames the selected session on its own channel', async () => {
		const { chat, sockets, init, dispose } = fixture();
		try {
			init();
			await flush();
			const socket = sockets[0];
			const selection = { range: { start: { line: 2, character: 0 }, end: { line: 4, character: 0 } } };
			const sent = chat.send('Review these files', [
				{ label: 'src/first file.ts', uri: 'file:///project/src/first%20file.ts' },
				{ label: 'src/example.ts', uri: 'file:///project/src/example.ts', selection, snapshot: 'Y29kZQ==' },
			]);
			await flush();
			const create = socket.request('createSession');
			const session = create.params.channel;
			const channel = session.replace('ahp-session:', 'ahp-chat:');
			socket.reply(create, {});
			await flush();
			socket.snapshot(session, { lifecycle: 'ready', title: 'New session', defaultChat: channel, chats: [{ resource: channel }] });
			await flush();
			socket.snapshot(channel, { resource: channel, turns: [] });
			await flush();
			const send = socket.request('dispatchAction', channel);
			assert.deepStrictEqual(send.params.action?.message?.attachments, [
				{ type: 'resource', label: 'src/first file.ts', displayKind: 'document', uri: 'file:///project/src/first%20file.ts' },
				{
					type: 'embeddedResource', displayKind: 'selection', label: 'src/example.ts:L3–L4',
					selection, data: 'Y29kZQ==', contentType: 'text/plain', _meta: { 'wingman.sourceUri': 'file:///project/src/example.ts' },
				},
			]);
			socket.echo(send, 1);
			assert.equal(await sent, true);

			await chat.renameSession('ahp-session:/old', 'Ignore this');
			assert.equal(socket.requests.filter(request => request.method === 'dispatchAction').length, 1);
			const renamed = chat.renameSession(session, 'Attachment review');
			await flush();
			const rename = socket.request('dispatchAction', session);
			assert.deepStrictEqual(rename.params.action, { type: 'session/titleChanged', title: 'Attachment review' });
			socket.echo(rename, 2);
			await renamed;
			assert.equal(chat.getView().session?.title, 'Attachment review');
		} finally {
			dispose();
		}
	});
});
