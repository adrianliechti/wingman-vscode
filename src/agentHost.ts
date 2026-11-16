import * as vscode from 'vscode';
import { spawn, ChildProcess } from 'node:child_process';
import { constants } from 'node:fs';
import { access, readFile, stat } from 'node:fs/promises';
import { get } from 'node:http';
import { homedir } from 'node:os';
import { isAbsolute, join } from 'node:path';
import { env } from 'node:process';

// Every window shares one local host at a fixed address, so each window writes
// the same entry to user settings, never to the workspace.
const hostPort = 9100;
const hostAddress = `ws://localhost:${hostPort}/ahp`;
const hostName = 'Wingman';
const watchInterval = 5_000;
// The Agents window registers both settings but reads remoteAgentHosts; editor
// windows register and read only workspaceRemoteAgentHosts.
const hostSettings = ['remoteAgentHosts', 'workspaceRemoteAgentHosts'] as const;
type HostSetting = typeof hostSettings[number];
type HostEntry = { address: string, name: string };
type AgentCommand = { executable: string, args: string[] };
/** ok: a host without a token answers. unauthorized: a host that requires one. */
type Probe = 'ok' | 'unauthorized' | 'down' | 'other';

/**
 * Keeps the shared host available while this window wants it. The first window
 * runs the process; the others use it and take over when that window closes.
 */
export class WingmanAgentHost implements vscode.Disposable {
	private child?: ChildProcess;
	private active = false;
	private watch?: ReturnType<typeof setInterval>;
	private pending: Promise<void> = Promise.resolve();
	private generation = 0;
	private disposed = false;
	private startupAbort?: AbortController;
	private readonly listeners: vscode.Disposable[];

	constructor(private readonly logger: vscode.LogOutputChannel) {
		this.listeners = [
			vscode.workspace.onDidGrantWorkspaceTrust(() => { void this.autoStart(); }),
			// The Agents window's folder follows the focused session and never gates the host.
			vscode.workspace.onDidChangeWorkspaceFolders(() => { if (registeredSetting() === 'workspaceRemoteAgentHosts') { void this.autoStart(); } }),
			vscode.workspace.onDidChangeConfiguration(event => {
				if (event.affectsConfiguration('wingman.agentHost') || event.affectsConfiguration('chat.remoteAgentHostsEnabled') || event.affectsConfiguration('chat.disableAIFeatures')) {
					void this.applyPreferences();
				} else if (hostSettings.some(setting => event.affectsConfiguration(`chat.${setting}`))) {
					void this.enqueue(() => this.followRemoval());
				}
			}),
		];
	}

	/** On activation: join or start the shared host, or remove an entry no host serves. */
	configure(): Promise<void> {
		return autoStartEnabled() ? this.start(false) : this.enqueue(() => this.pruneEntry());
	}

	start(interactive = true): Promise<void> {
		const generation = this.generation;
		return this.enqueue(async () => {
			if (this.isStale(generation)) {
				return;
			}
			try {
				await this.ensureHost(generation);
				if (this.isStale(generation)) {
					return;
				}
				this.setActive(true);
				if (interactive) {
					void vscode.window.showInformationMessage('Wingman: agent host is running. Select Wingman in Chat to start a session.');
				}
			} catch (error) {
				await this.stopServer();
				if (this.isStale(generation)) {
					return;
				}
				const message = error instanceof Error ? error.message : String(error);
				this.logger.warn('Agent host:', message);
				if (interactive) {
					void vscode.window.showErrorMessage(`Wingman: ${message}`);
				}
			}
		});
	}

	/** Stops the shared host for every window by removing its entry. */
	stop(): Promise<void> {
		void this.release();
		return this.enqueue(async () => {
			const setting = registeredSetting();
			if (setting) {
				await this.removeEntry(setting);
			}
		});
	}

	dispose(): void {
		void this.shutdown();
	}

	/** Leaves the entry in place so another window can take over the host. */
	shutdown(): Promise<void> {
		this.disposed = true;
		for (const listener of this.listeners) {
			listener.dispose();
		}
		return this.release();
	}

	private autoStart(): Promise<void> {
		return !this.active && autoStartEnabled() ? this.start(false) : Promise.resolve();
	}

	/** Preferences are shared by every window, so each one applies the change. */
	private applyPreferences(): Promise<void> {
		const chat = vscode.workspace.getConfiguration('chat');
		if (!autoStartEnabled() || chat.get('remoteAgentHostsEnabled') === false || chat.get('disableAIFeatures') === true) {
			return this.stop();
		}
		// Restart with the new executable; one window wins the port again.
		void this.release();
		return this.start(false);
	}

	/** Stops following the host here, and stops the process if this window runs it. */
	private release(): Promise<void> {
		this.generation++;
		this.setActive(false);
		// Interrupt a pending startup before waiting for its queued operation.
		this.startupAbort?.abort();
		this.child?.kill('SIGTERM');
		return this.enqueue(() => this.stopServer());
	}

	private isStale(generation: number): boolean {
		return this.disposed || generation !== this.generation;
	}

	private enqueue(action: () => Promise<void>): Promise<void> {
		this.pending = this.pending.then(action).catch(error => {
			this.logger.error('Agent host setup failed:', error instanceof Error ? error.message : String(error));
		});
		return this.pending;
	}

	private setActive(active: boolean): void {
		this.active = active;
		if (active && !this.watch) {
			this.watch = setInterval(() => { void this.enqueue(() => this.takeOver()); }, watchInterval);
		} else if (!active && this.watch) {
			clearInterval(this.watch);
			this.watch = undefined;
		}
	}

	/** Restart the host when the window running it closed or the process exited. */
	private async takeOver(): Promise<void> {
		// Only a closed port means the host is gone; a slow answer is not a reason to stop.
		if (!this.active || this.child || await probe() !== 'down') {
			return;
		}
		const generation = this.generation;
		try {
			await this.ensureHost(generation);
		} catch (error) {
			await this.stopServer();
			if (!this.isStale(generation)) {
				this.setActive(false);
				this.logger.warn('Agent host stopped:', error instanceof Error ? error.message : String(error));
			}
		}
	}

	/** Stop in another window removed the shared entry; stop following it here too. */
	private async followRemoval(): Promise<void> {
		const setting = registeredSetting();
		if (this.active && setting && !userEntries(setting).some(value => isSameAddress(value, hostAddress))) {
			this.logger.info('The Wingman agent host connection was removed from settings.');
			void this.release();
		}
	}

	private async ensureHost(generation: number): Promise<void> {
		const setting = this.checkWindow();
		let state = await probe();
		if (state === 'down') {
			try {
				await this.startServer(generation);
				state = 'ok';
			} catch (error) {
				// Windows starting together race for the port: the loser uses the winner.
				await this.stopServer();
				state = await probe();
				if (state === 'down' && !this.isStale(generation)) {
					await this.removeEntry(setting);
				}
				if (state !== 'ok') {
					throw error;
				}
			}
		}
		if (this.isStale(generation)) {
			return;
		}
		if (state === 'unauthorized') {
			throw new Error(`A Wingman host that requires a connection token is using port ${hostPort}. Stop it so VS Code windows can share one host.`);
		}
		if (state === 'other') {
			throw new Error(`Port ${hostPort} is in use by another program or not responding.`);
		}
		await this.ensureEntry(setting);
	}

	/** Returns the host setting this window reads, or throws why it cannot use the host. */
	private checkWindow(): HostSetting {
		if (!vscode.workspace.isTrusted) {
			throw new Error('Trust this workspace before starting the agent host.');
		}
		const chat = vscode.workspace.getConfiguration('chat');
		const [major, minor] = vscode.version.split('.').map(Number);
		if (major < 1 || (major === 1 && minor < 144)) {
			throw new Error('Wingman AHP requires VS Code 1.144 or later. Model sync remains available on this version.');
		}
		const setting = registeredSetting();
		if (!setting) {
			throw new Error('This VS Code window does not support AHP host configuration. Update VS Code to a release with chat.workspaceRemoteAgentHosts, or use the Agents window.');
		}
		// The Agents window chooses a folder per session; editor sessions use the window's folder.
		const folder = vscode.workspace.workspaceFolders?.[0];
		if (vscode.env.remoteName || setting === 'workspaceRemoteAgentHosts' && (!folder || folder.uri.scheme !== 'file')) {
			throw new Error('Open a local project folder to start the agent host. Remote workspaces are not supported yet.');
		}
		if (chat.get('remoteAgentHostsEnabled') === false || chat.get('disableAIFeatures') === true) {
			throw new Error('Agent host connections are disabled in VS Code settings.');
		}
		return setting;
	}

	private async startServer(generation: number): Promise<void> {
		const command = await this.resolveCommand();
		if (this.isStale(generation)) {
			return;
		}
		// No shell. A fixed port lets every window find the same host; a second
		// process fails to bind instead of starting another host elsewhere.
		// An inherited token would lock out VS Code, whose entry has none.
		const child = spawn(command.executable, [...command.args, 'host', '--port', String(hostPort)], {
			cwd: homedir(),
			env: { ...env, WINGMAN_HOST_TOKEN: '' },
			stdio: ['ignore', 'pipe', 'pipe'],
			windowsHide: true,
		});
		this.child = child;
		this.logger.info('Starting the shared Wingman agent host');
		this.startupAbort = new AbortController();
		let endpoint: string;
		try {
			endpoint = await this.waitForEndpoint(child, this.startupAbort.signal);
		} finally {
			this.startupAbort = undefined;
		}
		if (this.isStale(generation)) {
			return;
		}
		if (!isSameAddress({ address: endpoint }, hostAddress)) {
			throw new Error(`Wingman reported ${endpoint} instead of ${hostAddress}.`);
		}
		this.logger.info('Wingman agent host is running:', endpoint);
	}

	private async resolveCommand(): Promise<AgentCommand> {
		const config = vscode.workspace.getConfiguration('wingman');
		const setting = config.inspect<string>('agentHost.executable');
		// An explicitly configured "wingman" also overrides the discovery file.
		if ([setting?.globalValue, setting?.workspaceValue, setting?.workspaceFolderValue].some(value => value !== undefined)) {
			return parseCommand(config.get<string>('agentHost.executable', 'wingman'));
		}
		const pathFile = join(homedir(), '.wingman', 'path');
		try {
			const value = (await readFile(pathFile, 'utf8')).trim();
			if (value) {
				const command = await parseCommand(value);
				if (isAbsolute(command.executable) && !await isExecutable(command.executable)) {
					throw new Error(`Executable is missing or not executable: ${command.executable}`);
				}
				return command;
			}
		} catch (error) {
			if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
				this.logger.warn(`Could not use ${pathFile}; falling back to wingman on PATH:`, error instanceof Error ? error.message : String(error));
			}
		}
		return { executable: 'wingman', args: [] };
	}

	private waitForEndpoint(child: ChildProcess, signal: AbortSignal): Promise<string> {
		return new Promise((resolve, reject) => {
			let stderr = '';
			const cleanup = () => { clearTimeout(timeout); signal.removeEventListener('abort', abort); };
			const abort = () => { cleanup(); reject(new Error('Agent host startup cancelled.')); };
			const timeout = setTimeout(() => {
				cleanup();
				reject(new Error('Agent host startup timed out. See Wingman AI output for details.'));
			}, 30_000);
			signal.addEventListener('abort', abort, { once: true });
			child.stdout?.setEncoding('utf8').on('data', (chunk: string) => this.logger.append(chunk));
			child.stderr?.setEncoding('utf8').on('data', (chunk: string) => {
				this.logger.append(chunk);
				stderr = (stderr + chunk).slice(-8192);
				// Discover the URL itself, whether printed alone or after a log label.
				const match = /(?:^|\s)(ws:\/\/localhost:\d+\/ahp)\r?\n/.exec(stderr);
				if (match) {
					cleanup();
					resolve(match[1]);
				}
			});
			child.on('error', (error: NodeJS.ErrnoException) => {
				cleanup();
				reject(new Error(error.code === 'ENOENT'
					? 'Wingman executable was not found. Install wingman-agent, check ~/.wingman/path, or set wingman.agentHost.executable to its path or launcher command.'
					: `Could not start Wingman: ${error.message}`));
			});
			child.once('exit', (code, signal) => {
				cleanup();
				reject(new Error(`Agent host exited (${signal ?? code}). See Wingman AI output for details.`));
				if (this.child === child) {
					// An active window, this one or another, restarts it on its next check.
					this.child = undefined;
					this.logger.info('Wingman agent host exited:', signal ?? code);
				}
			});
		});
	}

	private async stopServer(): Promise<void> {
		const child = this.child;
		this.child = undefined;
		if (child && child.pid && child.exitCode === null && child.signalCode === null) {
			await new Promise<void>(resolve => {
				const timeout = setTimeout(() => { child.kill('SIGKILL'); resolve(); }, 3000);
				child.once('exit', () => { clearTimeout(timeout); resolve(); });
				child.kill('SIGTERM');
			});
		}
	}

	/** Adds the shared entry to user settings unless an entry already points at the host. */
	private async ensureEntry(setting: HostSetting): Promise<void> {
		const config = vscode.workspace.getConfiguration('chat');
		const inspected = config.inspect<unknown[]>(setting);
		const entries = inspected?.globalValue ?? [];
		if (!Array.isArray(entries)) {
			throw new Error(`chat.${setting} must be an array in user settings.`);
		}
		if (!entries.some(value => isSameAddress(value, hostAddress))) {
			await config.update(setting, [...entries, { address: hostAddress, name: hostName } satisfies HostEntry], vscode.ConfigurationTarget.Global);
		}
		// Workspace values replace the user's list rather than adding to it.
		const overrides = [inspected?.workspaceValue, inspected?.workspaceFolderValue].filter(Array.isArray);
		if (overrides.some(value => !value.some(entry => isSameAddress(entry, hostAddress)))) {
			this.logger.warn(`chat.${setting} in this workspace's settings hides the Wingman host from user settings. Remove it there or add ${hostAddress}.`);
		}
	}

	/** Removes the shared entry; an entry the user renamed or extended stays theirs. */
	private async removeEntry(setting: HostSetting): Promise<void> {
		const entries = userEntries(setting);
		const remaining = entries.filter(value => !isOwnEntry(value));
		if (remaining.length !== entries.length) {
			await vscode.workspace.getConfiguration('chat').update(setting, remaining.length ? remaining : undefined, vscode.ConfigurationTarget.Global);
		}
	}

	/** Without automatic startup, nothing restarts a host whose window closed. */
	private async pruneEntry(): Promise<void> {
		const setting = registeredSetting();
		if (setting && !vscode.env.remoteName && userEntries(setting).some(isOwnEntry) && await probe() === 'down') {
			await this.removeEntry(setting);
		}
	}
}

function autoStartEnabled(): boolean {
	return vscode.workspace.getConfiguration('wingman').get<boolean>('agentHost.autoStart', true);
}

/** The host setting this window reads, if this VS Code release registers one. */
function registeredSetting(): HostSetting | undefined {
	const chat = vscode.workspace.getConfiguration('chat');
	return hostSettings.find(key => chat.inspect(key)?.defaultValue !== undefined);
}

function userEntries(setting: HostSetting): unknown[] {
	const value = vscode.workspace.getConfiguration('chat').inspect<unknown[]>(setting)?.globalValue;
	return Array.isArray(value) ? value : [];
}

/** Checks the host without opening an AHP connection: WebSocket routes answer 426 to plain requests. */
function probe(): Promise<Probe> {
	return new Promise(resolve => {
		// A fresh connection each time: a pooled socket may belong to a host that exited.
		const request = get({ host: 'localhost', port: hostPort, path: '/ahp', timeout: 5000, agent: false }, response => {
			response.resume();
			resolve(response.statusCode === 426 ? 'ok' : response.statusCode === 401 ? 'unauthorized' : 'other');
		});
		request.on('timeout', () => request.destroy(new Error('timeout')));
		request.on('error', (error: NodeJS.ErrnoException) => resolve(error.code === 'ECONNREFUSED' ? 'down' : 'other'));
	});
}

async function isExecutable(filename: string): Promise<boolean> {
	try {
		await access(filename, constants.X_OK);
		return (await stat(filename)).isFile();
	} catch {
		return false;
	}
}

/** Split a launcher into argv without evaluating shell expressions. */
async function parseCommand(value: string): Promise<AgentCommand> {
	const line = value.trim();
	if (!line || /[\0\r\n]/.test(line)) {
		throw new Error('Set the Wingman command to an executable path or a single launcher command line.');
	}
	// The path file has historically contained a bare executable path. Keep
	// existing paths with spaces intact, even when they have not been quoted.
	if (isAbsolute(line) && await isExecutable(line)) {
		return { executable: line, args: [] };
	}
	const words: string[] = [];
	let word = '';
	let started = false;
	let quote: string | undefined;
	for (let i = 0; i < line.length; i++) {
		const char = line[i];
		const next = line[i + 1];
		if (char === '\\' && quote !== "'" && next !== undefined
			&& (next === '\\' || next === quote || (!quote && /[\s'"]/.test(next)))) {
			word += next;
			started = true;
			i++;
		} else if (char === quote) {
			quote = undefined;
		} else if (!quote && (char === '"' || char === "'")) {
			quote = char;
			started = true;
		} else if (!quote && /\s/.test(char)) {
			if (started) {
				words.push(word);
				word = '';
				started = false;
			}
		} else {
			word += char;
			started = true;
		}
	}
	if (quote) {
		throw new Error('The Wingman command contains an unmatched quote.');
	}
	if (started) {
		words.push(word);
	}
	const [executable, ...args] = words;
	if (!executable) {
		throw new Error('The Wingman command must start with an executable.');
	}
	return { executable, args };
}

function isSameAddress(value: unknown, address: string): value is { address: string } {
	return typeof value === 'object' && value !== null && 'address' in value && typeof value.address === 'string'
		&& value.address.replace(/^ws:\/\//, '') === address.replace(/^ws:\/\//, '');
}

/** Exactly the entry this extension writes, without user changes. */
function isOwnEntry(value: unknown): boolean {
	return isSameAddress(value, hostAddress) && Object.keys(value).length === 2 && 'name' in value && value.name === hostName;
}
