import * as assert from 'node:assert';
import { EventEmitter } from 'node:events';
import { constants, readFileSync } from 'node:fs';
import * as path from 'node:path';
import { runInNewContext } from 'node:vm';
import * as crypto from 'node:crypto';

import type { WingmanAgentHost } from '../agentHost';

const editorSetting = 'workspaceRemoteAgentHosts';
const agentsSetting = 'remoteAgentHosts';
const ownedKey = 'wingman.agentHost.registration';
const otherHost = { address: 'wss://other.example/ahp', name: 'Other', connectionToken: 'test-token' };
const normalize = (value: unknown) => JSON.parse(JSON.stringify(value));

class FakeChild extends EventEmitter {
	readonly stdout = Object.assign(new EventEmitter(), { setEncoding() { return this; } });
	readonly stderr = Object.assign(new EventEmitter(), { setEncoding() { return this; } });
	pid: number | undefined = 123;
	exitCode: number | null = null;
	signalCode: string | null = null;
	kills: string[] = [];
	kill(signal: string) {
		this.kills.push(signal);
		if (this.exitCode === null && this.signalCode === null) {
			this.signalCode = signal;
			this.emit('exit', null, signal);
		}
		return true;
	}
}

function harness(options: { setting?: string, bothSettings?: boolean, supported?: boolean, trusted?: boolean, remote?: string, version?: string, autoStart?: boolean, startup?: 'error' | 'exit' | 'wait', port?: number, failUpdate?: number, recordedCommand?: string | Promise<string>, executables?: string[] } = {}) {
	const setting = options.setting ?? editorSetting;
	const global = new Map<string, unknown>([[setting, [otherHost]]]);
	const workspace = new Map<string, unknown>();
	const state = new Map<string, unknown>();
	const messages: string[] = [];
	const logs: unknown[] = [];
	const children: FakeChild[] = [];
	const spawns: { executable: string, args: string[], options: unknown }[] = [];
	const writes: { key: string, target: number, value: unknown }[] = [];
	const pathReads: string[] = [];
	const executables = new Set(options.executables ?? ['/Applications/Wingman Tools/wingman']);
	const preferences = new Map<string, unknown>([['agentHost.autoStart', options.autoStart ?? true], ['agentHost.executable', '/Applications/Wingman Tools/wingman']]);
	const listeners = new Map<string, (...args: never[]) => void>();
	let startup = options.startup;
	const listen = (name: string) => (callback: (...args: never[]) => void) => {
		listeners.set(name, callback);
		return { dispose() { listeners.delete(name); } };
	};
	const vscode = {
		version: options.version ?? '1.147.0',
		env: { remoteName: options.remote },
		ConfigurationTarget: { Global: 1, Workspace: 2 },
		workspace: {
			isTrusted: options.trusted ?? true,
			workspaceFolders: [{ name: 'project', uri: { scheme: 'file', fsPath: '/projects/my project' } }],
			onDidGrantWorkspaceTrust: listen('trust'),
			onDidChangeWorkspaceFolders: listen('folders'),
			onDidChangeConfiguration: listen('settings'),
			getConfiguration: (section: string) => section === 'wingman' ? {
				get: (key: string, fallback: unknown) => preferences.get(key) ?? fallback,
				inspect: (key: string) => ({ defaultValue: key === 'agentHost.executable' ? 'wingman' : undefined, globalValue: preferences.get(key) }),
			} : {
				get: (key: string, fallback: unknown) => workspace.get(key) ?? global.get(key) ?? fallback,
				inspect: (key: string) => ({
					defaultValue: (key === setting || options.bothSettings && key === editorSetting) && options.supported !== false ? [] : undefined,
					globalValue: global.get(key),
					workspaceValue: workspace.get(key),
				}),
				update: async (key: string, value: unknown, target: number) => {
					assert.strictEqual(key, setting, 'must not write unsupported host settings');
					writes.push({ key, target, value });
					if (writes.length === options.failUpdate) {
						throw new Error('Simulated settings write failure');
					}
					const store = target === 1 ? global : workspace;
					if (value === undefined) {
						store.delete(key);
					} else {
						store.set(key, normalize(value));
					}
				},
			},
		},
		window: {
			showInformationMessage: async (message: string) => { messages.push(message); },
			showErrorMessage: async (message: string) => { messages.push(message); },
		},
	};
	const filename = path.join(__dirname, '../agentHost.js');
	const module = { exports: {} as { WingmanAgentHost: new (...args: unknown[]) => WingmanAgentHost } };
	runInNewContext(readFileSync(filename, 'utf8'), {
		module, exports: module.exports, setTimeout, clearTimeout, AbortController,
		require: (name: string) => {
			if (name === 'vscode') {
				return vscode;
			}
			if (name === 'node:crypto') {
				return crypto;
			}
			if (name === 'node:path') {
				return path;
			}
			if (name === 'node:os') {
				return { homedir: () => '/users/test' };
			}
			if (name === 'node:process') {
				return { env: { PATH: '/bin' } };
			}
			if (name === 'node:fs') {
				return { constants };
			}
			if (name === 'node:fs/promises') {
				return {
					readFile: async (filename: string, encoding: string) => {
						assert.strictEqual(filename, path.join('/users/test', '.wingman', 'path'));
						assert.strictEqual(encoding, 'utf8');
						pathReads.push(filename);
						if (options.recordedCommand === undefined) {
							throw Object.assign(new Error('missing path file'), { code: 'ENOENT' });
						}
						return options.recordedCommand;
					},
					access: async (filename: string, mode: number) => {
						assert.strictEqual(mode, constants.X_OK);
						if (!executables.has(filename)) {
							throw Object.assign(new Error('missing executable'), { code: 'ENOENT' });
						}
					},
					stat: async (filename: string) => ({ isFile: () => executables.has(filename) }),
				};
			}
			assert.strictEqual(name, 'node:child_process');
			return { spawn: (executable: string, args: string[], spawnOptions: unknown) => {
				spawns.push({ executable, args, options: spawnOptions });
				const child = new FakeChild();
				children.push(child);
				queueMicrotask(() => {
					if (startup === 'error') {
						child.pid = undefined;
						child.emit('error', Object.assign(new Error('not found'), { code: 'ENOENT' }));
					} else if (startup === 'exit') {
						child.exitCode = 1;
						child.emit('exit', 1, null);
					} else if (startup !== 'wait') {
						child.stderr.emit('data', 'Starting...\nAHP end');
						child.stderr.emit('data', `point: ws://localhost:${options.port ?? 9100 + children.length}/ahp\n`);
					}
				});
				return child;
			} };
		},
	}, { filename });
	const host = new module.exports.WingmanAgentHost({
		workspaceState: {
			get: (key: string) => state.get(key),
			update: async (key: string, value: unknown) => { state.set(key, value); },
		},
	}, {
		info: (...args: unknown[]) => logs.push(args), warn: (...args: unknown[]) => logs.push(args),
		error: (...args: unknown[]) => logs.push(args), append: (value: string) => logs.push(value),
	});
	return { host, children, spawns, writes, state, global, workspace, messages, logs, preferences, vscode, listeners, pathReads,
		set startup(value: typeof startup) { startup = value; },
	};
}

suite('Wingman agent host lifecycle', () => {
	const apps: ReturnType<typeof harness>[] = [];
	function app(options?: Parameters<typeof harness>[0]) {
		const result = harness(options);
		apps.push(result);
		return result;
	}
	teardown(async () => {
		await Promise.all(apps.splice(0).map(app => app.host.shutdown()));
	});

	test('starts without a shell, uses the reported port, preserves hosts, and restores inheritance on stop', async () => {
		const h = app();
		await h.host.configure();
		assert.deepStrictEqual(normalize(h.spawns), [{
			executable: '/Applications/Wingman Tools/wingman', args: ['server', '--no-browser'],
			options: { cwd: '/projects/my project', stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true },
		}]);
		assert.deepStrictEqual(h.workspace.get(editorSetting), [otherHost, { address: 'ws://localhost:9101/ahp', name: 'Wingman (project)' }]);
		assert.ok(!JSON.stringify([...h.state.values()]).includes('test-token'));
		await h.host.stop();
		assert.ok(!h.workspace.has(editorSetting));
		assert.deepStrictEqual(h.global.get(editorSetting), [otherHost]);
		assert.ok(h.children[0].kills.includes('SIGTERM'));
		assert.strictEqual(h.state.get(ownedKey), undefined);
	});

	test('does not duplicate processes or configuration when Start commands overlap', async () => {
		const h = app();
		await Promise.all([h.host.start(), h.host.start(), h.host.start()]);
		assert.strictEqual(h.spawns.length, 1);
		assert.strictEqual(h.writes.length, 1);
	});

	test('detects bare and labeled WebSocket endpoints split across output chunks', async () => {
		for (const prefix of ['', 'AHP endpoint: ', 'Listening: ']) {
			const h = app({ startup: 'wait' });
			const starting = h.host.configure();
			await new Promise(resolve => setImmediate(resolve));
			const child = h.children[0];
			child.stderr.emit('data', `Wingman running at http://localhost:9476\n${prefix}ws://local`);
			await new Promise(resolve => setImmediate(resolve));
			assert.strictEqual(h.writes.length, 0);
			child.stderr.emit('data', 'host:9476/ahp');
			await new Promise(resolve => setImmediate(resolve));
			assert.strictEqual(h.writes.length, 0, 'wait for the complete endpoint line');
			child.stderr.emit('data', '\r\n');
			await starting;
			assert.deepStrictEqual(h.workspace.get(editorSetting), [otherHost, { address: 'ws://localhost:9476/ahp', name: 'Wingman (project)' }]);
		}
	});

	test('discovers executable paths from ~/.wingman/path, preserving spaces and trimming line endings', async () => {
		for (const executable of ['/opt/homebrew/bin/wingman', '/Applications/Wingman Tools/wingman']) {
			const h = app({ recordedCommand: `  ${executable}\r\n`, executables: [executable] });
			h.preferences.delete('agentHost.executable');
			await h.host.configure();
			assert.strictEqual(h.spawns[0].executable, executable);
			assert.deepStrictEqual(normalize(h.spawns[0].args), ['server', '--no-browser']);
			assert.strictEqual(h.writes.length, 1);
		}
	});

	test('launches a proxy command from the path file or an explicit setting', async () => {
		for (const explicit of [false, true]) {
			const command = '/bin/devtool wingman';
			const h = app({ recordedCommand: command, executables: ['/bin/devtool'] });
			h.preferences.delete('agentHost.executable');
			if (explicit) {
				h.preferences.set('agentHost.executable', command);
			}
			await h.host.start();
			assert.deepStrictEqual(normalize(h.spawns), [{
				executable: '/bin/devtool', args: ['wingman', 'server', '--no-browser'],
				options: { cwd: '/projects/my project', stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true },
			}]);
			assert.strictEqual(h.pathReads.length, explicit ? 0 : 1);
			assert.strictEqual(h.writes.length, 1);
		}
	});

	test('preserves quoted paths, quoted and escaped arguments, and literal shell characters', async () => {
		const h = app({
			recordedCommand: String.raw`"/Applications/Dev Tools/devtool" --profile 'work account' --label work\ account --empty "" --literal '$(touch /tmp/example);$HOME' wingman`,
			executables: ['/Applications/Dev Tools/devtool'],
		});
		h.preferences.delete('agentHost.executable');
		await h.host.start();
		assert.strictEqual(h.spawns[0].executable, '/Applications/Dev Tools/devtool');
		assert.deepStrictEqual(normalize(h.spawns[0].args), [
			'--profile', 'work account', '--label', 'work account', '--empty', '',
			'--literal', '$(touch /tmp/example);$HOME', 'wingman', 'server', '--no-browser',
		]);
		assert.ok(!('shell' in (h.spawns[0].options as object)));
	});

	test('explicit settings take precedence over the path file, including an explicit wingman on PATH', async () => {
		for (const executable of ['/Applications/Wingman Tools/wingman', 'wingman']) {
			const h = app({ recordedCommand: '/bin/devtool wingman', executables: [executable, '/bin/devtool'] });
			h.preferences.set('agentHost.executable', executable);
			await h.host.start();
			assert.strictEqual(h.spawns[0].executable, executable);
			assert.strictEqual(h.pathReads.length, 0);
		}
	});

	test('falls back to PATH for missing, empty, stale or malformed discovery files', async () => {
		for (const recordedCommand of [undefined, ' \r\n', '/missing/wingman', '/missing/devtool wingman', '"unterminated']) {
			const h = app({ recordedCommand });
			h.preferences.delete('agentHost.executable');
			await h.host.configure();
			assert.strictEqual(h.spawns[0].executable, 'wingman');
			assert.deepStrictEqual(normalize(h.spawns[0].args), ['server', '--no-browser']);
			assert.strictEqual(h.messages.length, 0);
		}
	});

	test('rejects malformed explicit commands without falling back or registering', async () => {
		for (const command of ['', '"unterminated', '"" wingman', '/bin/devtool\nwingman']) {
			const h = app({ recordedCommand: '/opt/homebrew/bin/wingman' });
			h.preferences.set('agentHost.executable', command);
			await h.host.start();
			assert.strictEqual(h.spawns.length, 0);
			assert.strictEqual(h.writes.length, 0);
			assert.strictEqual(h.pathReads.length, 0);
			assert.strictEqual(h.messages.length, 1);
		}
	});

	test('Stop during executable discovery prevents a late server from starting', async () => {
		let finishRead!: (value: string) => void;
		const h = app({ recordedCommand: new Promise<string>(resolve => { finishRead = resolve; }) });
		h.preferences.delete('agentHost.executable');
		const starting = h.host.start();
		await new Promise(resolve => setImmediate(resolve));
		assert.strictEqual(h.pathReads.length, 1);
		const stopping = h.host.stop();
		finishRead('wingman');
		await Promise.all([starting, stopping]);
		assert.strictEqual(h.spawns.length, 0);
		assert.strictEqual(h.writes.length, 0);
	});

	test('uses the Agents window setting only when it is registered', async () => {
		const h = app({ setting: agentsSetting, bothSettings: true });
		await h.host.start();
		assert.strictEqual(h.writes[0].target, 1);
		await h.host.stop();
		assert.deepStrictEqual(h.global.get(agentsSetting), [otherHost]);
	});

	test('the Agents window runs one host for all projects, without a folder and across folder changes', async () => {
		const h = app({ setting: agentsSetting, bothSettings: true });
		h.vscode.workspace.workspaceFolders = [];
		await h.host.configure();
		const { env, ...options } = h.spawns[0].options as { env: Record<string, string> };
		assert.deepStrictEqual(normalize({ ...h.spawns[0], options }), {
			executable: '/Applications/Wingman Tools/wingman', args: ['host'],
			options: { cwd: '/users/test', stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true },
		});
		assert.strictEqual(env.PATH, '/bin');
		assert.match(env.WINGMAN_HOST_TOKEN, /^[\w-]{32}$/);
		assert.deepStrictEqual(h.global.get(agentsSetting), [otherHost, { address: 'ws://localhost:9101/ahp', name: 'Wingman', connectionToken: env.WINGMAN_HOST_TOKEN }]);
		// The folder follows the focused session; the host and its sessions stay.
		h.vscode.workspace.workspaceFolders = [{ name: 'other', uri: { scheme: 'vscode-agent-host', fsPath: '/elsewhere' } }];
		h.listeners.get('folders')!();
		await h.host.start();
		assert.strictEqual(h.spawns.length, 1);
		assert.deepStrictEqual(h.children[0].kills, []);
		await h.host.stop();
		assert.deepStrictEqual(h.global.get(agentsSetting), [otherHost]);
	});

	test('keeps edits to other hosts during cleanup and preserves renamed owned entries', async () => {
		const h = app();
		await h.host.start();
		const entries = h.workspace.get(editorSetting) as unknown[];
		const added = { address: 'localhost:1234/ahp', name: 'Added later' };
		h.workspace.set(editorSetting, [...entries, added]);
		await h.host.stop();
		assert.deepStrictEqual(h.workspace.get(editorSetting), [otherHost, added]);
		await h.host.start();
		const renamed = { address: 'ws://localhost:9102/ahp', name: 'My custom name', connectionToken: 'keep-me' };
		h.workspace.set(editorSetting, [otherHost, added, renamed]);
		await h.host.stop();
		assert.deepStrictEqual(h.workspace.get(editorSetting), [otherHost, added, renamed]);
	});

	test('does not claim or remove a pre-existing address', async () => {
		const h = app();
		h.workspace.set(editorSetting, [{ address: 'localhost:9101/ahp', name: 'My host' }]);
		await h.host.start();
		await h.host.stop();
		assert.strictEqual(h.writes.length, 0);
	});

	test('refreshes a renamed Agents host token across restarts without taking ownership', async () => {
		const h = app({ setting: agentsSetting, port: 9100 });
		await h.host.start();
		let entry = (h.global.get(agentsSetting) as typeof otherHost[])[1];
		entry = { ...entry, name: 'My Wingman' };
		h.global.set(agentsSetting, [otherHost, entry]);
		await h.host.stop();
		assert.deepStrictEqual(h.global.get(agentsSetting), [otherHost, entry]);

		for (let restart = 0; restart < 2; restart++) {
			const oldToken = entry.connectionToken;
			await h.host.start();
			const { env } = h.spawns[h.spawns.length - 1].options as { env: Record<string, string> };
			assert.notStrictEqual(env.WINGMAN_HOST_TOKEN, oldToken);
			entry = { ...entry, connectionToken: env.WINGMAN_HOST_TOKEN };
			assert.deepStrictEqual(h.global.get(agentsSetting), [otherHost, entry]);
			assert.deepStrictEqual(normalize(h.writes[h.writes.length - 2].value), [otherHost], 'disconnect before reconnecting with the new token');
			assert.strictEqual(h.state.get(ownedKey), undefined, 'a renamed entry remains user-owned');
			await h.host.stop();
			assert.deepStrictEqual(h.global.get(agentsSetting), [otherHost, entry]);
		}
	});

	test('updates missing and stale tokens on pre-existing Agents entries while preserving their options', async () => {
		for (const connectionToken of [undefined, 'stale-token']) {
			const h = app({ setting: agentsSetting });
			const existing = { address: 'localhost:9101/ahp', name: 'My host', connectionToken, customOption: 'keep-me' };
			h.global.set(agentsSetting, [otherHost, existing]);
			await h.host.start();
			const { env } = h.spawns[0].options as { env: Record<string, string> };
			const expected = [otherHost, { ...existing, connectionToken: env.WINGMAN_HOST_TOKEN }];
			assert.deepStrictEqual(h.global.get(agentsSetting), expected);
			assert.strictEqual(h.state.get(ownedKey), undefined);
			await h.host.stop();
			assert.deepStrictEqual(h.global.get(agentsSetting), expected);
		}
	});

	test('restores user entries and reports failure when refreshing a token cannot be saved', async () => {
		const h = app({ setting: agentsSetting, failUpdate: 2 });
		const existing = { address: 'localhost:9101/ahp', name: 'My host', connectionToken: 'keep-me' };
		h.global.set(agentsSetting, [otherHost, existing]);
		await h.host.start();
		assert.deepStrictEqual(h.global.get(agentsSetting), [otherHost, existing]);
		assert.strictEqual(h.state.get(ownedKey), undefined);
		assert.ok(h.children[0].kills.includes('SIGTERM'));
		assert.strictEqual(h.messages.length, 1);
		assert.ok(h.messages[0].includes('Simulated settings write failure'));
	});

	test('recovers a stale registration before starting a new server', async () => {
		const h = app();
		const entry = { address: 'localhost:9000/ahp', name: 'Wingman (project)' };
		const written = [otherHost, entry];
		h.workspace.set(editorSetting, written);
		h.state.set(ownedKey, {
			setting: editorSetting, target: 2, entry, inherited: true,
			writtenHash: crypto.createHash('sha256').update(JSON.stringify(written)).digest('hex'),
		});
		await h.host.configure();
		assert.deepStrictEqual(h.workspace.get(editorSetting), [otherHost, { address: 'ws://localhost:9101/ahp', name: 'Wingman (project)' }]);
	});

	test('skips unsupported, untrusted, remote, disabled and folderless windows', async () => {
		for (const options of [{ supported: false }, { trusted: false }, { remote: 'ssh-remote' }, { version: '1.134.0' }]) {
			const h = app(options);
			await h.host.start();
			assert.strictEqual(h.spawns.length, 0);
			assert.strictEqual(h.writes.length, 0);
			assert.strictEqual(h.messages.length, 1);
		}
		const h = app();
		h.global.set('remoteAgentHostsEnabled', false);
		await h.host.start();
		h.global.delete('remoteAgentHostsEnabled');
		h.vscode.workspace.workspaceFolders = [];
		await h.host.start();
		assert.strictEqual(h.spawns.length, 0);
	});

	test('manual startup works with auto-start off and preference changes stop the server', async () => {
		const h = app({ autoStart: false });
		await h.host.configure();
		assert.strictEqual(h.spawns.length, 0);
		await h.host.start();
		assert.strictEqual(h.spawns.length, 1);
		await h.host.configure();
		assert.ok(h.children[0].signalCode);
		assert.ok(!h.workspace.has(editorSetting));
	});

	test('failed startup does not register a host and can be retried', async () => {
		for (const startup of ['error', 'exit'] as const) {
			const h = app({ startup });
			await h.host.start();
			assert.strictEqual(h.writes.length, 0);
			assert.strictEqual(h.messages.length, 1);
			h.startup = undefined;
			await h.host.start();
			assert.strictEqual(h.writes.length, 1);
		}
	});

	test('a missing binary during automatic startup leaves host settings untouched without a popup', async () => {
		const h = app({ startup: 'error' });
		await h.host.configure();
		assert.strictEqual(h.writes.length, 0);
		assert.strictEqual(h.messages.length, 0);
		assert.strictEqual(h.state.get(ownedKey), undefined);
		assert.deepStrictEqual(h.global.get(editorSetting), [otherHost]);
		assert.ok(JSON.stringify(h.logs).includes('executable was not found'));
	});

	test('Stop interrupts pending startup without registering a dead server', async () => {
		const h = app({ startup: 'wait' });
		const starting = h.host.start();
		await new Promise(resolve => setImmediate(resolve));
		await h.host.stop();
		await starting;
		assert.strictEqual(h.writes.length, 0);
		assert.strictEqual(h.messages.length, 0);
		assert.ok(h.children[0].signalCode);
	});

	test('unexpected exit removes the connection and shutdown prevents further starts', async () => {
		const h = app();
		await h.host.start();
		h.children[0].exitCode = 1;
		h.children[0].emit('exit', 1, null);
		await new Promise(resolve => setImmediate(resolve));
		assert.ok(!h.workspace.has(editorSetting));
		await h.host.shutdown();
		await h.host.start();
		assert.strictEqual(h.spawns.length, 1);
		assert.strictEqual(h.listeners.size, 0);
	});
});
