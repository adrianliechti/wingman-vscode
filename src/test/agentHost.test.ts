import * as assert from 'node:assert';
import { EventEmitter } from 'node:events';
import { constants, readFileSync } from 'node:fs';
import * as path from 'node:path';
import { runInNewContext } from 'node:vm';

import type { WingmanAgentHost } from '../agentHost';

const editorSetting = 'workspaceRemoteAgentHosts';
const agentsSetting = 'remoteAgentHosts';
const address = 'ws://localhost:9100/ahp';
const pathFile = path.join('/users/test', '.wingman', 'path');
const otherHost = { address: 'wss://other.example/ahp', name: 'Other', connectionToken: 'test-token' };
const normalize = (value: unknown) => JSON.parse(JSON.stringify(value));
const hostArgs = ['host', '--port', '9100'];
const ownEntry = { address, name: 'Wingman' };

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
	crash() {
		this.exitCode = 1;
		this.emit('exit', 1, null);
	}
}

/** What VS Code windows share: user settings, global storage and port 9100. */
type Machine = {
	global: Map<string, unknown>;
	host?: { token?: string, child?: FakeChild };
	foreign?: boolean;
	windows: WindowRef[];
};
type WindowRef = { host: WingmanAgentHost, listeners: Map<string, (...args: never[]) => void>, readonly pending: Promise<void> };
type WindowOptions = {
	agents?: boolean, supported?: boolean, trusted?: boolean, remote?: string, version?: string, autoStart?: boolean,
	startup?: 'error' | 'exit' | 'wait', failUpdate?: number, recordedCommand?: string | Promise<string>, executables?: string[],
	/** WINGMAN_HOME in the extension host's environment, and the path file it should lead to. */
	wingmanHome?: { value: string, pathFile: string },
};

function machine(): Machine {
	return { global: new Map<string, unknown>([[editorSetting, [otherHost]], [agentsSetting, [otherHost]]]), windows: [] };
}

function openWindow(m: Machine, options: WindowOptions = {}) {
	// The Agents window registers both settings and reads remoteAgentHosts.
	const registered = options.supported === false ? [] : options.agents ? [agentsSetting, editorSetting] : [editorSetting];
	const workspace = new Map<string, unknown>();
	const messages: string[] = [];
	const logs: unknown[] = [];
	const children: FakeChild[] = [];
	const spawns: { executable: string, args: string[], options: unknown }[] = [];
	const writes: { key: string, target: number, value: unknown }[] = [];
	const pathReads: string[] = [];
	const intervals = new Set<() => void>();
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
			workspaceFolders: options.agents ? [] : [{ name: 'project', uri: { scheme: 'file', fsPath: '/projects/my project' } }],
			onDidGrantWorkspaceTrust: listen('trust'),
			onDidChangeWorkspaceFolders: listen('folders'),
			onDidChangeConfiguration: listen('settings'),
			getConfiguration: (section: string) => section === 'wingman' ? {
				get: (key: string, fallback: unknown) => preferences.get(key) ?? fallback,
				inspect: (key: string) => ({ defaultValue: key === 'agentHost.executable' ? 'wingman' : undefined, globalValue: preferences.get(key) }),
			} : {
				get: (key: string, fallback: unknown) => workspace.get(key) ?? m.global.get(key) ?? fallback,
				inspect: (key: string) => ({
					defaultValue: registered.includes(key) ? [] : undefined,
					globalValue: m.global.get(key),
					workspaceValue: workspace.get(key),
				}),
				update: async (key: string, value: unknown, target: number) => {
					assert.ok(registered.includes(key), 'must not write unregistered host settings');
					writes.push({ key, target, value: normalize(value ?? null) });
					if (writes.length === options.failUpdate) {
						throw new Error('Simulated settings write failure');
					}
					const store = target === 1 ? m.global : workspace;
					if (value === undefined) {
						store.delete(key);
					} else {
						store.set(key, normalize(value));
					}
					changed(target === 1 ? m.windows : [win], `chat.${key}`);
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
	const errno = (code: string) => Object.assign(new Error(code), { code });
	const modules: Record<string, unknown> = {
		vscode,
		'node:path': path,
		'node:os': { homedir: () => '/users/test' },
		'node:process': { env: { PATH: '/bin', ...options.wingmanHome && { WINGMAN_HOME: options.wingmanHome.value } } },
		'node:fs': { constants },
		'node:fs/promises': {
			readFile: async (filename: string, encoding: string) => {
				assert.strictEqual(encoding, 'utf8');
				assert.strictEqual(filename, options.wingmanHome?.pathFile ?? pathFile);
				pathReads.push(filename);
				if (options.recordedCommand === undefined) {
					throw errno('ENOENT');
				}
				return options.recordedCommand;
			},
			access: async (filename: string, mode: number) => {
				assert.strictEqual(mode, constants.X_OK);
				if (!executables.has(filename)) {
					throw errno('ENOENT');
				}
			},
			stat: async (filename: string) => ({ isFile: () => executables.has(filename) }),
		},
		'node:http': {
			get: (request: { host: string, port: number, path: string }, callback: (response: { statusCode: number, resume(): void }) => void) => {
				assert.deepStrictEqual([request.host, request.port, request.path], ['localhost', 9100, '/ahp']);
				const emitter = Object.assign(new EventEmitter(), { destroy(error: Error) { emitter.emit('error', error); } });
				queueMicrotask(() => {
					const response = (statusCode: number) => callback({ statusCode, resume() {} });
					if (m.foreign) {
						response(404);
					} else if (!m.host) {
						emitter.emit('error', errno('ECONNREFUSED'));
					} else {
						response(m.host.token ? 401 : 426);
					}
				});
				return emitter;
			},
		},
		'node:child_process': {
			spawn: (executable: string, args: string[], spawnOptions: { env: Record<string, string> }) => {
				spawns.push({ executable, args, options: spawnOptions });
				const child = new FakeChild();
				children.push(child);
				child.on('exit', () => {
					if (m.host?.child === child) {
						m.host = undefined;
					}
				});
				queueMicrotask(() => {
					if (startup === 'error') {
						child.pid = undefined;
						child.emit('error', errno('ENOENT'));
					} else if (startup === 'exit') {
						child.crash();
					} else if (startup !== 'wait') {
						if (m.host || m.foreign) {
							child.stderr.emit('data', 'listen tcp 127.0.0.1:9100: bind: address already in use\n');
							child.crash();
						} else {
							m.host = { token: spawnOptions.env.WINGMAN_HOST_TOKEN || undefined, child };
							child.stderr.emit('data', 'Starting...\nAHP end');
							child.stderr.emit('data', `point: ${address}\n`);
						}
					}
				});
				return child;
			},
		},
	};
	runInNewContext(readFileSync(filename, 'utf8'), {
		module, exports: module.exports, setTimeout, clearTimeout, AbortController,
		setInterval: (callback: () => void) => { intervals.add(callback); return callback; },
		clearInterval: (callback: () => void) => { intervals.delete(callback); },
		require: (name: string) => {
			assert.ok(name in modules, `unexpected module ${name}`);
			return modules[name];
		},
	}, { filename });
	const host = new module.exports.WingmanAgentHost({
		info: (...args: unknown[]) => logs.push(args), warn: (...args: unknown[]) => logs.push(args),
		error: (...args: unknown[]) => logs.push(args), append: (value: string) => logs.push(value),
	});
	const win = {
		host, children, spawns, writes, workspace, messages, logs, preferences, vscode, listeners, pathReads, intervals,
		set startup(value: typeof startup) { startup = value; },
		get pending() { return (host as unknown as { pending: Promise<void> }).pending; },
		/** Runs the periodic check for a host that went away. */
		tick() {
			for (const callback of intervals) {
				callback();
			}
		},
	};
	m.windows.push(win);
	return win;
}

function changed(windows: WindowRef[], key: string) {
	for (const window of windows) {
		window.listeners.get('settings')?.({ affectsConfiguration: (section: string) => section === key || key.startsWith(`${section}.`) } as never);
	}
}

/** Waits until every window's queued work, including work it caused elsewhere, is done. */
async function settle(m: Machine) {
	for (let round = 0; round < 50; round++) {
		const pending = m.windows.map(window => window.pending);
		await Promise.all(pending);
		await new Promise(resolve => setImmediate(resolve));
		if (m.windows.every((window, index) => window.pending === pending[index])) {
			return;
		}
	}
	throw new Error('windows did not settle');
}

/** Reads the host afresh after other windows changed it. */
function runningHost(m: Machine) {
	return m.host;
}


suite('Wingman agent host lifecycle', () => {
	const machines: Machine[] = [];
	function setup() {
		const result = machine();
		machines.push(result);
		return result;
	}
	teardown(async () => {
		for (const m of machines.splice(0)) {
			await Promise.all(m.windows.map(window => window.host.shutdown()));
		}
	});

	test('runs one host without a shell and registers it only in user settings', async () => {
		const m = setup();
		const h = openWindow(m);
		await h.host.configure();
		const { env, ...options } = h.spawns[0].options as { env: Record<string, string> };
		assert.deepStrictEqual(normalize({ ...h.spawns[0], options }), {
			executable: '/Applications/Wingman Tools/wingman', args: hostArgs,
			options: { cwd: '/users/test', stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true },
		});
		assert.deepStrictEqual(normalize(env), { PATH: '/bin', WINGMAN_HOST_TOKEN: '' }, 'clears an inherited token');
		assert.deepStrictEqual(m.global.get(editorSetting), [otherHost, ownEntry]);
		assert.strictEqual(h.workspace.size, 0);
		assert.ok(h.writes.every(write => write.target === 1), 'never writes workspace settings');
		await h.host.stop();
		assert.deepStrictEqual(m.global.get(editorSetting), [otherHost]);
		assert.ok(h.children[0].kills.includes('SIGTERM'));
		assert.strictEqual(m.host, undefined);
	});

	test('other windows use the running host and one takes over when its window closes', async () => {
		const m = setup();
		const [first, second, third] = [openWindow(m), openWindow(m), openWindow(m)];
		await first.host.configure();
		await second.host.configure();
		await third.host.configure();
		await settle(m);
		assert.deepStrictEqual([first.spawns.length, second.spawns.length, third.spawns.length], [1, 0, 0]);
		assert.deepStrictEqual([second.writes.length, third.writes.length], [0, 0], 'the shared entry is already in place');

		await first.host.shutdown();
		assert.strictEqual(m.host, undefined);
		assert.deepStrictEqual(m.global.get(editorSetting), [otherHost, ownEntry], 'closing a window keeps the entry');
		second.tick();
		third.tick();
		await settle(m);
		assert.strictEqual(second.spawns.length + third.spawns.length, 2, 'both try to take over');
		assert.ok(runningHost(m), 'one wins the port');
		assert.deepStrictEqual(m.global.get(editorSetting), [otherHost, ownEntry]);
		assert.deepStrictEqual([second.messages, third.messages], [[], []]);
	});

	test('windows starting together share one host and one entry', async () => {
		const m = setup();
		const windows = [openWindow(m), openWindow(m), openWindow(m)];
		await Promise.all(windows.map(window => window.host.configure()));
		await settle(m);
		const running = windows.flatMap(window => window.children).filter(child => child.exitCode === null && child.signalCode === null);
		assert.strictEqual(running.length, 1);
		assert.strictEqual(m.host?.child, running[0]);
		assert.deepStrictEqual(m.global.get(editorSetting), [otherHost, ownEntry]);
		assert.ok(windows.every(window => window.intervals.size === 1), 'every window watches the host');
	});

	test('Stop in any window stops the host everywhere', async () => {
		for (const stopper of [0, 1]) {
			const m = setup();
			const windows = [openWindow(m), openWindow(m)];
			await windows[0].host.configure();
			await windows[1].host.configure();
			await windows[stopper].host.stop();
			await settle(m);
			assert.strictEqual(m.host, undefined);
			assert.ok(windows[0].children[0].signalCode);
			assert.deepStrictEqual(m.global.get(editorSetting), [otherHost]);
			for (const window of windows) {
				window.tick();
			}
			await settle(m);
			assert.strictEqual(windows[0].spawns.length + windows[1].spawns.length, 1, 'no window takes over');
			assert.ok(windows.every(window => window.intervals.size === 0));
		}
	});

	test('the Agents window shares the host through its own setting', async () => {
		const m = setup();
		const agents = openWindow(m, { agents: true });
		const editor = openWindow(m);
		await agents.host.configure();
		await editor.host.configure();
		assert.strictEqual(agents.spawns.length + editor.spawns.length, 1);
		assert.deepStrictEqual(m.global.get(agentsSetting), [otherHost, ownEntry]);
		assert.deepStrictEqual(m.global.get(editorSetting), [otherHost, ownEntry]);
		// The Agents window's folder follows the focused session; the host stays.
		agents.vscode.workspace.workspaceFolders = [{ name: 'other', uri: { scheme: 'vscode-agent-host', fsPath: '/elsewhere' } }];
		agents.listeners.get('folders')!();
		await settle(m);
		assert.deepStrictEqual(agents.children[0].kills, []);
		// Stop in the Agents window leaves editor windows their host.
		await agents.host.stop();
		editor.tick();
		await settle(m);
		assert.deepStrictEqual(m.global.get(agentsSetting), [otherHost]);
		assert.deepStrictEqual(m.global.get(editorSetting), [otherHost, ownEntry]);
		assert.strictEqual(editor.spawns.length, 1);
		assert.ok(m.host);
	});

	test('does not duplicate processes or configuration when Start commands overlap', async () => {
		const m = setup();
		const h = openWindow(m);
		await Promise.all([h.host.start(), h.host.start(), h.host.start()]);
		assert.strictEqual(h.spawns.length, 1);
		assert.strictEqual(h.writes.length, 1);
	});

	test('detects bare and labeled WebSocket endpoints split across output chunks', async () => {
		for (const prefix of ['', 'AHP endpoint: ', 'Listening: ']) {
			const m = setup();
			const h = openWindow(m, { startup: 'wait' });
			const starting = h.host.configure();
			while (!h.children.length) {
				await new Promise(resolve => setImmediate(resolve));
			}
			const child = h.children[0];
			child.stderr.emit('data', `Wingman running at http://localhost:9476\n${prefix}ws://local`);
			await new Promise(resolve => setImmediate(resolve));
			assert.strictEqual(h.writes.length, 0);
			child.stderr.emit('data', 'host:9100/ahp');
			await new Promise(resolve => setImmediate(resolve));
			assert.strictEqual(h.writes.length, 0, 'wait for the complete endpoint line');
			child.stderr.emit('data', '\r\n');
			await starting;
			assert.deepStrictEqual(m.global.get(editorSetting), [otherHost, ownEntry]);
		}
	});

	test('rejects a host that reports another port', async () => {
		const m = setup();
		const h = openWindow(m, { startup: 'wait' });
		const starting = h.host.start();
		while (!h.children.length) {
			await new Promise(resolve => setImmediate(resolve));
		}
		h.children[0].stderr.emit('data', 'AHP endpoint: ws://localhost:9476/ahp\n');
		await starting;
		assert.strictEqual(h.writes.length, 0);
		assert.ok(h.children[0].signalCode);
		assert.match(h.messages[0], /instead of ws:\/\/localhost:9100\/ahp/);
	});

	test('discovers executable paths from ~/.wingman/path, preserving spaces and trimming line endings', async () => {
		for (const executable of ['/opt/homebrew/bin/wingman', '/Applications/Wingman Tools/wingman']) {
			const h = openWindow(setup(), { recordedCommand: `  ${executable}\r\n`, executables: [executable] });
			h.preferences.delete('agentHost.executable');
			await h.host.configure();
			assert.strictEqual(h.spawns[0].executable, executable);
			assert.deepStrictEqual(normalize(h.spawns[0].args), hostArgs);
			assert.strictEqual(h.writes.length, 1);
		}
	});

	test('reads the path file from WINGMAN_HOME, resolving a relative one against the home directory', async () => {
		for (const wingmanHome of [
			{ value: '/test', pathFile: '/test/path' },
			{ value: 'config/wingman', pathFile: '/users/test/config/wingman/path' },
			{ value: '', pathFile },
		]) {
			const h = openWindow(setup(), { recordedCommand: '/test/cli lala', executables: ['/test/cli'], wingmanHome });
			h.preferences.delete('agentHost.executable');
			await h.host.start();
			assert.strictEqual(h.spawns[0].executable, '/test/cli');
			assert.deepStrictEqual(normalize(h.spawns[0].args), ['lala', ...hostArgs]);
			assert.strictEqual((h.spawns[0].options as { env: Record<string, string> }).env.WINGMAN_HOME, wingmanHome.value, 'the host uses the same home');
			assert.deepStrictEqual(h.pathReads, [wingmanHome.pathFile]);
		}
	});

	test('launches a proxy command from the path file or an explicit setting', async () => {
		for (const explicit of [false, true]) {
			const command = '/bin/devtool wingman';
			const h = openWindow(setup(), { recordedCommand: command, executables: ['/bin/devtool'] });
			h.preferences.delete('agentHost.executable');
			if (explicit) {
				h.preferences.set('agentHost.executable', command);
			}
			await h.host.start();
			assert.strictEqual(h.spawns[0].executable, '/bin/devtool');
			assert.deepStrictEqual(normalize(h.spawns[0].args), ['wingman', ...hostArgs]);
			assert.strictEqual(h.pathReads.length, explicit ? 0 : 1);
			assert.strictEqual(h.writes.length, 1);
		}
	});

	test('preserves quoted paths, quoted and escaped arguments, and literal shell characters', async () => {
		const h = openWindow(setup(), {
			recordedCommand: String.raw`"/Applications/Dev Tools/devtool" --profile 'work account' --label work\ account --empty "" --literal '$(touch /tmp/example);$HOME' wingman`,
			executables: ['/Applications/Dev Tools/devtool'],
		});
		h.preferences.delete('agentHost.executable');
		await h.host.start();
		assert.strictEqual(h.spawns[0].executable, '/Applications/Dev Tools/devtool');
		assert.deepStrictEqual(normalize(h.spawns[0].args), [
			'--profile', 'work account', '--label', 'work account', '--empty', '',
			'--literal', '$(touch /tmp/example);$HOME', 'wingman', ...hostArgs,
		]);
		assert.ok(!('shell' in (h.spawns[0].options as object)));
	});

	test('explicit settings take precedence over the path file, including an explicit wingman on PATH', async () => {
		for (const executable of ['/Applications/Wingman Tools/wingman', 'wingman']) {
			const h = openWindow(setup(), { recordedCommand: '/bin/devtool wingman', executables: [executable, '/bin/devtool'] });
			h.preferences.set('agentHost.executable', executable);
			await h.host.start();
			assert.strictEqual(h.spawns[0].executable, executable);
			assert.strictEqual(h.pathReads.length, 0);
		}
	});

	test('falls back to PATH for missing, empty, stale or malformed discovery files', async () => {
		for (const recordedCommand of [undefined, ' \r\n', '/missing/wingman', '/missing/devtool wingman', '"unterminated']) {
			const h = openWindow(setup(), { recordedCommand });
			h.preferences.delete('agentHost.executable');
			await h.host.configure();
			assert.strictEqual(h.spawns[0].executable, 'wingman');
			assert.deepStrictEqual(normalize(h.spawns[0].args), hostArgs);
			assert.strictEqual(h.messages.length, 0);
		}
	});

	test('rejects malformed explicit commands without falling back or registering', async () => {
		for (const command of ['', '"unterminated', '"" wingman', '/bin/devtool\nwingman']) {
			const h = openWindow(setup(), { recordedCommand: '/opt/homebrew/bin/wingman' });
			h.preferences.set('agentHost.executable', command);
			await h.host.start();
			assert.strictEqual(h.spawns.length, 0);
			assert.strictEqual(h.writes.length, 0);
			assert.strictEqual(h.pathReads.length, 0);
			assert.strictEqual(h.messages.length, 1);
		}
	});

	test('changing the executable restarts the host with it', async () => {
		const m = setup();
		const h = openWindow(m);
		await h.host.configure();
		h.preferences.set('agentHost.executable', 'wingman');
		changed([h], 'wingman.agentHost.executable');
		await settle(m);
		assert.ok(h.children[0].signalCode);
		assert.strictEqual(h.spawns[1].executable, 'wingman');
		assert.strictEqual(m.host?.child, h.children[1]);
		assert.deepStrictEqual(m.global.get(editorSetting), [otherHost, ownEntry]);
	});

	test('Stop during executable discovery prevents a late server from starting', async () => {
		let finishRead!: (value: string) => void;
		const h = openWindow(setup(), { recordedCommand: new Promise<string>(resolve => { finishRead = resolve; }) });
		h.preferences.delete('agentHost.executable');
		const starting = h.host.start();
		while (!h.pathReads.length) {
			await new Promise(resolve => setImmediate(resolve));
		}
		const stopping = h.host.stop();
		finishRead('wingman');
		await Promise.all([starting, stopping]);
		assert.strictEqual(h.spawns.length, 0);
		assert.strictEqual(h.writes.length, 0);
	});

	test('uses renamed or extended entries, including tokens from earlier versions, and leaves them on stop', async () => {
		const m = setup();
		const h = openWindow(m);
		const existing = [otherHost, { address: 'localhost:9100/ahp', name: 'My host', connectionToken: 'old-token', customOption: 'keep-me' }];
		m.global.set(editorSetting, existing);
		await h.host.start();
		assert.strictEqual(h.spawns.length, 1);
		assert.strictEqual(h.writes.length, 0);
		await h.host.stop();
		assert.deepStrictEqual(m.global.get(editorSetting), existing);
	});

	test('reports a failed settings write and stops the process it started', async () => {
		const m = setup();
		const h = openWindow(m, { failUpdate: 1 });
		await h.host.start();
		assert.deepStrictEqual(m.global.get(editorSetting), [otherHost]);
		assert.ok(h.children[0].kills.includes('SIGTERM'));
		assert.strictEqual(h.intervals.size, 0);
		assert.match(h.messages[0], /Simulated settings write failure/);
	});

	test('reports a port used by another host or program without touching settings', async () => {
		for (const occupant of ['host', 'program'] as const) {
			const m = setup();
			const h = openWindow(m);
			if (occupant === 'host') {
				m.host = { token: 'secret' };
			} else {
				m.foreign = true;
			}
			await h.host.start();
			assert.strictEqual(h.spawns.length, 0);
			assert.strictEqual(h.writes.length, 0);
			assert.match(h.messages[0], occupant === 'host' ? /requires a connection token is using port 9100/ : /in use by another program/);
		}
	});

	test('warns when workspace settings hide the user entry, without writing them', async () => {
		const m = setup();
		const h = openWindow(m);
		h.workspace.set(editorSetting, [otherHost]);
		await h.host.start();
		assert.ok(h.writes.every(write => write.target === 1));
		assert.deepStrictEqual(h.workspace.get(editorSetting), [otherHost]);
		assert.ok(JSON.stringify(h.logs).includes('hides the Wingman host'));
	});

	test('skips unsupported, untrusted, remote and folderless editor windows', async () => {
		for (const options of [{ supported: false }, { trusted: false }, { remote: 'ssh-remote' }, { version: '1.134.0' }]) {
			const h = openWindow(setup(), options);
			await h.host.start();
			assert.strictEqual(h.spawns.length, 0);
			assert.strictEqual(h.writes.length, 0);
			assert.strictEqual(h.messages.length, 1);
		}
		const m = setup();
		const h = openWindow(m);
		h.vscode.workspace.workspaceFolders = [];
		await h.host.start();
		assert.strictEqual(h.spawns.length, 0);
	});

	test('runs for the Wingman panel while VS Code\'s own AI features are disabled', async () => {
		for (const [key, value] of [['disableAIFeatures', true], ['remoteAgentHostsEnabled', false]] as const) {
			const m = setup();
			m.global.set(key, value);
			const h = openWindow(m);
			await h.host.configure();
			assert.strictEqual(h.spawns.length, 1);
			// Chat finds the entry once its features are switched on again.
			assert.deepStrictEqual(m.global.get(editorSetting), [otherHost, ownEntry]);

			// Switching them on or off neither stops nor restarts a host in use.
			m.global.delete(key);
			changed(m.windows, `chat.${key}`);
			m.global.set(key, value);
			changed(m.windows, `chat.${key}`);
			await settle(m);
			assert.strictEqual(h.spawns.length, 1);
			assert.deepStrictEqual(h.children[0].kills, []);
			assert.ok(runningHost(m));

			// The panel reports failures only; the command also says where to go next.
			await h.host.start(true, false);
			assert.deepStrictEqual(h.messages, []);
			await h.host.start();
			assert.deepStrictEqual(h.messages, ['Wingman: agent host is running. Open the Wingman panel to start a session.']);
		}
	});

	test('opening a folder in an empty editor window starts automatically', async () => {
		const m = setup();
		const h = openWindow(m);
		const folders = h.vscode.workspace.workspaceFolders;
		h.vscode.workspace.workspaceFolders = [];
		await h.host.configure();
		assert.strictEqual(h.spawns.length, 0);
		h.vscode.workspace.workspaceFolders = folders;
		h.listeners.get('folders')!();
		await settle(m);
		assert.strictEqual(h.spawns.length, 1);
		h.listeners.get('folders')!();
		await settle(m);
		assert.strictEqual(h.spawns.length, 1, 'an active window keeps its host');
	});

	test('manual startup works with auto-start off and turning it off stops the host everywhere', async () => {
		const m = setup();
		const [first, second] = [openWindow(m, { autoStart: false }), openWindow(m)];
		await first.host.configure();
		assert.strictEqual(first.spawns.length, 0);
		await first.host.start();
		await second.host.configure();
		assert.strictEqual(first.spawns.length + second.spawns.length, 1);
		second.preferences.set('agentHost.autoStart', false);
		changed([second], 'wingman.agentHost.autoStart');
		await settle(m);
		assert.ok(first.children[0].signalCode);
		assert.strictEqual(m.host, undefined);
		assert.deepStrictEqual(m.global.get(editorSetting), [otherHost]);
		assert.ok(first.intervals.size === 0 && second.intervals.size === 0);
	});

	test('with auto-start off, activation removes an entry only when no host serves it', async () => {
		for (const running of [false, true]) {
			const m = setup();
			const starter = openWindow(m);
			await starter.host.start();
			if (!running) {
				await starter.host.shutdown();
			}
			const h = openWindow(m, { autoStart: false });
			await h.host.configure();
			await settle(m);
			assert.deepStrictEqual(m.global.get(editorSetting), running ? [otherHost, ownEntry] : [otherHost]);
			assert.strictEqual(h.spawns.length, 0);
		}
	});

	test('failed startup does not register a host and can be retried', async () => {
		for (const startup of ['error', 'exit'] as const) {
			const h = openWindow(setup(), { startup });
			await h.host.start();
			assert.strictEqual(h.writes.length, 0);
			assert.strictEqual(h.messages.length, 1);
			h.startup = undefined;
			await h.host.start();
			assert.strictEqual(h.writes.length, 1);
		}
	});

	test('a missing binary during automatic startup leaves host settings untouched without a popup', async () => {
		const m = setup();
		const h = openWindow(m, { startup: 'error' });
		await h.host.configure();
		assert.strictEqual(h.writes.length, 0);
		assert.strictEqual(h.messages.length, 0);
		assert.deepStrictEqual(m.global.get(editorSetting), [otherHost]);
		assert.ok(JSON.stringify(h.logs).includes('executable was not found'));
	});

	test('Stop interrupts pending startup without registering a dead server', async () => {
		const h = openWindow(setup(), { startup: 'wait' });
		const starting = h.host.start();
		while (!h.children.length) {
			await new Promise(resolve => setImmediate(resolve));
		}
		await h.host.stop();
		await starting;
		assert.strictEqual(h.writes.length, 0);
		assert.strictEqual(h.messages.length, 0);
		assert.ok(h.children[0].signalCode);
	});

	test('an active window restarts a host that exited, and shutdown prevents further starts', async () => {
		const m = setup();
		const h = openWindow(m);
		await h.host.start();
		h.children[0].crash();
		h.tick();
		await settle(m);
		assert.strictEqual(h.spawns.length, 2);
		assert.strictEqual(m.host?.child, h.children[1]);
		await h.host.shutdown();
		await h.host.start();
		h.tick();
		await settle(m);
		assert.strictEqual(h.spawns.length, 2);
		assert.strictEqual(h.listeners.size, 0);
		assert.strictEqual(h.intervals.size, 0);
	});

	test('an unanswered check does not end takeover', async () => {
		const m = setup();
		const [first, second] = [openWindow(m), openWindow(m)];
		await first.host.start();
		await second.host.configure();
		m.foreign = true;
		second.tick();
		await settle(m);
		assert.strictEqual(second.intervals.size, 1, 'still following the host');
		m.foreign = false;
		await first.host.shutdown();
		second.tick();
		await settle(m);
		assert.strictEqual(m.host?.child, second.children[0]);
	});

	test('renaming the entry does not stop the host', async () => {
		const m = setup();
		const h = openWindow(m);
		await h.host.start();
		m.global.set(editorSetting, [otherHost, { ...ownEntry, name: 'My Wingman' }]);
		changed([h], `chat.${editorSetting}`);
		await settle(m);
		assert.deepStrictEqual(h.children[0].kills, []);
		assert.strictEqual(h.intervals.size, 1);
	});

	test('a failed takeover removes the dead entry and stops following it', async () => {
		const m = setup();
		const [first, second] = [openWindow(m), openWindow(m)];
		await first.host.start();
		await second.host.configure();
		second.startup = 'error';
		await first.host.shutdown();
		second.tick();
		await settle(m);
		assert.deepStrictEqual(m.global.get(editorSetting), [otherHost]);
		assert.strictEqual(second.intervals.size, 0);
		assert.strictEqual(second.messages.length, 0);
		assert.ok(JSON.stringify(second.logs).includes('executable was not found'));
	});
});
