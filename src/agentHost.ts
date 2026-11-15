import * as vscode from 'vscode';
import { spawn, ChildProcess } from 'node:child_process';
import { createHash, randomBytes } from 'node:crypto';
import { constants } from 'node:fs';
import { access, readFile, stat } from 'node:fs/promises';
import { homedir } from 'node:os';
import { isAbsolute, join } from 'node:path';
import { env } from 'node:process';

const registrationKey = 'wingman.agentHost.registration';
// Agents windows register both settings; editor windows register only the
// workspace setting. Prefer the Agents-only setting when it is available.
const hostSettings = ['remoteAgentHosts', 'workspaceRemoteAgentHosts'] as const;
type HostSetting = typeof hostSettings[number];
type HostEntry = { address: string, name: string, connectionToken?: string };
type AgentCommand = { executable: string, args: string[] };
type Registration = {
	setting: HostSetting;
	target: vscode.ConfigurationTarget;
	entry: HostEntry;
	inherited: boolean;
	writtenHash: string;
};

/**
 * Owns one server and only its own host entry. An editor window's server is
 * for its first folder; the Agents window's serves every project.
 */
export class WingmanAgentHost implements vscode.Disposable {
	private child?: ChildProcess;
	private shared = false;
	private pending: Promise<void> = Promise.resolve();
	private generation = 0;
	private disposed = false;
	private startupAbort?: AbortController;
	private readonly listeners: vscode.Disposable[];

	constructor(private readonly context: vscode.ExtensionContext, private readonly logger: vscode.LogOutputChannel) {
		this.listeners = [
			vscode.workspace.onDidGrantWorkspaceTrust(() => { void this.configure(); }),
			// The Agents window's folder follows the focused session; its host stays.
			vscode.workspace.onDidChangeWorkspaceFolders(() => { if (!this.shared) { void this.configure(); } }),
			vscode.workspace.onDidChangeConfiguration(event => {
				if (event.affectsConfiguration('wingman.agentHost') || event.affectsConfiguration('chat.remoteAgentHostsEnabled') || event.affectsConfiguration('chat.disableAIFeatures')) {
					void this.configure();
				}
			}),
		];
	}

	/** Apply startup preferences; changes restart the server with the new configuration. */
	configure(): Promise<void> {
		const stopped = this.stop();
		return vscode.workspace.getConfiguration('wingman').get<boolean>('agentHost.autoStart', true)
			? this.start(false) : stopped;
	}

	start(interactive = true): Promise<void> {
		const generation = this.generation;
		return this.enqueue(async () => {
			if (this.disposed || generation !== this.generation) {
				return;
			}
			try {
				await this.startServer(generation);
				if (interactive && this.child) {
					void vscode.window.showInformationMessage('Wingman: agent host is running. Select Wingman in Chat to start a session.');
				}
			} catch (error) {
				await this.stopServer();
				if (generation !== this.generation || this.disposed) {
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

	stop(): Promise<void> {
		this.generation++;
		// Interrupt a pending startup before waiting for its queued operation.
		this.startupAbort?.abort();
		this.child?.kill('SIGTERM');
		return this.enqueue(() => this.stopServer());
	}

	dispose(): void {
		void this.shutdown();
	}

	shutdown(): Promise<void> {
		this.disposed = true;
		for (const listener of this.listeners) {
			listener.dispose();
		}
		return this.stop();
	}

	private enqueue(action: () => Promise<void>): Promise<void> {
		this.pending = this.pending.then(action).catch(error => {
			this.logger.error('Agent host setup failed:', error instanceof Error ? error.message : String(error));
		});
		return this.pending;
	}

	private async startServer(generation: number): Promise<void> {
		if (this.child) {
			return;
		}
		if (!vscode.workspace.isTrusted) {
			throw new Error('Trust this workspace before starting the agent host.');
		}
		const chat = vscode.workspace.getConfiguration('chat');
		const [major, minor] = vscode.version.split('.').map(Number);
		if (major < 1 || (major === 1 && minor < 144)) {
			throw new Error('Wingman AHP requires VS Code 1.144 or later. Model sync remains available on this version.');
		}
		// These settings are registered in different VS Code window types. Do
		// not write an unknown setting on older releases (model sync still works).
		const setting = hostSettings.find(key => chat.inspect(key)?.defaultValue !== undefined);
		if (!setting) {
			throw new Error('This VS Code window does not support AHP host configuration. Update VS Code to a release with chat.workspaceRemoteAgentHosts, or use the Agents window.');
		}
		const shared = this.shared = setting === 'remoteAgentHosts';
		const folder = vscode.workspace.workspaceFolders?.[0];
		if (vscode.env.remoteName || !shared && (!folder || folder.uri.scheme !== 'file')) {
			throw new Error('Open a local project folder to start the agent host. Remote workspaces are not supported yet.');
		}
		if (chat.get('remoteAgentHostsEnabled') === false || chat.get('disableAIFeatures') === true) {
			throw new Error('Agent host connections are disabled in VS Code settings.');
		}
		await this.removeRegistration();
		if (this.disposed || generation !== this.generation) {
			return;
		}

		const command = await this.resolveCommand();
		if (this.disposed || generation !== this.generation) {
			return;
		}
		// No shell and no fixed port: Wingman chooses its default or an available
		// port and reports the actual endpoint. Each window owns its own process.
		// A host for every project only accepts this window's token.
		const token = shared ? randomBytes(24).toString('base64url') : undefined;
		const child = spawn(command.executable, [...command.args, ...(shared ? ['host'] : ['server', '--no-browser'])], {
			cwd: shared ? homedir() : folder!.uri.fsPath,
			env: token ? { ...env, WINGMAN_HOST_TOKEN: token } : undefined,
			stdio: ['ignore', 'pipe', 'pipe'],
			windowsHide: true,
		});
		this.child = child;
		this.logger.info('Starting Wingman agent host', shared ? 'for all projects' : `in ${folder!.uri.fsPath}`);
		this.startupAbort = new AbortController();
		let endpoint: string;
		try {
			endpoint = await this.waitForEndpoint(child, this.startupAbort.signal);
		} finally {
			this.startupAbort = undefined;
		}
		if (this.disposed || generation !== this.generation) {
			return;
		}
		await this.register(setting, shared
			? { address: endpoint, name: 'Wingman', connectionToken: token }
			: { address: endpoint, name: `Wingman (${folder!.name})` });
		this.logger.info('Configured Wingman agent host:', endpoint);
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
				void this.enqueue(async () => {
					if (this.child === child) {
						this.child = undefined;
						this.logger.info('Wingman agent host exited:', signal ?? code);
						await this.removeRegistration();
					}
				});
			});
		});
	}

	private async register(setting: HostSetting, entry: HostEntry): Promise<void> {
		const config = vscode.workspace.getConfiguration('chat');
		const target = setting === 'workspaceRemoteAgentHosts' ? vscode.ConfigurationTarget.Workspace : vscode.ConfigurationTarget.Global;
		const inspected = config.inspect<unknown[]>(setting);
		const previous = target === vscode.ConfigurationTarget.Workspace ? inspected?.workspaceValue : inspected?.globalValue;
		const entries = config.get<unknown[]>(setting, []);
		if (!Array.isArray(entries)) {
			throw new Error(`chat.${setting} must be an array.`);
		}
		if (entries.some(value => isSameAddress(value, entry.address))) {
			if (entry.connectionToken) {
				// This process owns the endpoint, so an existing connection needs
				// its new token. Preserve the user's name and other options.
				const updated = entries.map(value => isSameAddress(value, entry.address)
					? { ...value, connectionToken: entry.connectionToken } : value);
				// VS Code keeps the token in its live connection. Remove the address
				// first so it creates a new connection instead of retrying the old token.
				await config.update(setting, entries.filter(value => !isSameAddress(value, entry.address)), target);
				try {
					await config.update(setting, updated, target);
				} catch (error) {
					await config.update(setting, previous, target);
					throw error;
				}
			}
			return; // A user-owned connection must never become ours to remove.
		}
		const written = [...entries, entry];
		// Persist ownership first so a reload/crash can clean up the old port.
		// Store a fingerprint, not copies of other hosts' connection tokens.
		await this.context.workspaceState.update(registrationKey, {
			setting, target, entry, inherited: previous === undefined, writtenHash: fingerprint(written),
		} satisfies Registration);
		await config.update(setting, written, target);
	}

	private async removeRegistration(): Promise<void> {
		const owned = this.context.workspaceState.get<Registration>(registrationKey);
		if (!owned) {
			return;
		}
		const config = vscode.workspace.getConfiguration('chat');
		const inspected = config.inspect<unknown[]>(owned.setting);
		const current = owned.target === vscode.ConfigurationTarget.Workspace ? inspected?.workspaceValue : inspected?.globalValue;
		if (Array.isArray(current)) {
			const remaining = current.filter(entry => JSON.stringify(entry) !== JSON.stringify(owned.entry));
			// Restore inheritance when unchanged; otherwise preserve user edits,
			// including a renamed entry or one with additional connection options.
			if (fingerprint(current) === owned.writtenHash) {
				await config.update(owned.setting, owned.inherited ? undefined : remaining, owned.target);
			} else if (remaining.length !== current.length) {
				await config.update(owned.setting, remaining, owned.target);
			}
		}
		await this.context.workspaceState.update(registrationKey, undefined);
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
		await this.removeRegistration();
	}
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

function fingerprint(value: unknown): string {
	return createHash('sha256').update(JSON.stringify(value)).digest('hex');
}
