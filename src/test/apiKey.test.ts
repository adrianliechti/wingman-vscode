import * as assert from 'node:assert';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import * as path from 'node:path';
import { runInNewContext } from 'node:vm';

import { toCustomEndpointModels } from '../models';

const baseUrl = 'http://localhost:4242/v1';
const models = toCustomEndpointModels(['gpt-6-sol'], baseUrl).models;
const defaultFile = '/User/chatLanguageModels.json';
const profileFile = '/User/profiles/work/chatLanguageModels.json';

type Group = { name: string, vendor: string, apiKey?: string, models?: unknown[], [key: string]: unknown };
type Uri = { fsPath: string };

function harness(initialGroups: Group[] = [wingmanGroup()]) {
	const files = new Map<string, string>([[defaultFile, JSON.stringify(initialGroups)]]);
	const extensionSecrets = new Map<string, string>();
	const nativeSecrets = new Map<string, string>();
	const state = new Map<string, unknown>();
	const commands = new Map<string, () => Promise<void>>();
	const messages: string[] = [];
	const logs: unknown[][] = [];
	const discoveryHeaders: string[] = [];
	let apiKey = 'first-test-key';
	let secretCreations = 0;
	let failSecretCreation = false;
	let failGroupWrite = false;
	let failedFile = defaultFile;
	let currentFile = defaultFile;
	let onSecretCreation: (() => void) | undefined;

	class FileSystemError extends Error { code = 'FileNotFound'; }
	const disposable = { dispose() { } };
	const logger = {
		...disposable,
		info: (...args: unknown[]) => logs.push(args),
		warn: (...args: unknown[]) => logs.push(args),
		error: (...args: unknown[]) => logs.push(args),
	};
	const mockVscode = {
		FileSystemError,
		FileType: { Directory: 2 },
		Uri: { joinPath: (uri: Uri, ...parts: string[]) => ({ fsPath: path.posix.join(uri.fsPath, ...parts) }) },
		window: {
			createOutputChannel: () => logger,
			showInformationMessage: async (message: string) => { messages.push(message); },
			showWarningMessage: async (message: string) => { messages.push(message); },
			showErrorMessage: async (message: string) => { messages.push(message); },
		},
		lm: {
			onDidChangeChatModels: () => disposable,
			selectChatModels: async () => [],
		},
		workspace: {
			getConfiguration: () => ({ get: (name: string) => name === 'apiKey' ? apiKey : baseUrl }),
			fs: {
				readDirectory: async () => files.has(profileFile) ? [['work', 2]] : [],
				readFile: async (uri: Uri) => {
					const content = files.get(uri.fsPath);
					if (content === undefined) {
						throw new FileSystemError();
					}
					return new TextEncoder().encode(content);
				},
				writeFile: async (uri: Uri, content: Uint8Array) => {
					const text = new TextDecoder().decode(content);
					if (failGroupWrite && uri.fsPath === failedFile && JSON.parse(text).some((group: Group) => group.name === 'Wingman' && group.apiKey !== '${input:chat.lm.secret.old}')) {
						throw new Error('Simulated write failure');
					}
					files.set(uri.fsPath, text);
				},
			},
		},
		commands: {
			registerCommand: (name: string, callback: () => Promise<void>) => {
				commands.set(name, callback);
				return disposable;
			},
			executeCommand: async (command: string, group: Group) => {
				assert.ok(['lm.addLanguageModelsProviderGroup', 'lm.migrateLanguageModelsProviderGroup'].includes(command));
				const groups: Group[] = JSON.parse(files.get(currentFile) ?? '[]');
				const storedGroup = { ...group };
				// Like VS Code, create secrets before checking for duplicate groups,
				// but only when the caller actually supplies a key.
				if (typeof group.apiKey === 'string') {
					if (failSecretCreation) {
						throw new Error('Simulated secret creation failure');
					}
					const reference = '${input:chat.lm.secret.' + nativeSecrets.size + '}';
					nativeSecrets.set(reference, group.apiKey);
					storedGroup.apiKey = reference;
					secretCreations++;
				}
				if (groups.some(existing => existing.name === group.name && existing.vendor === group.vendor)) {
					throw new Error('Language model group already exists');
				}
				groups.push(storedGroup);
				files.set(currentFile, JSON.stringify(groups));
				onSecretCreation?.();
			},
		},
	};
	const context = {
		subscriptions: [],
		globalStorageUri: { fsPath: '/User/globalStorage/wingman' },
		globalState: {
			get: (key: string) => state.get(key),
			update: async (key: string, value: unknown) => { state.set(key, value); },
		},
		secrets: {
			get: async (key: string) => extensionSecrets.get(key),
			store: async (key: string, value: string) => { extensionSecrets.set(key, value); },
		},
	};
	const filename = path.join(__dirname, '../extension.js');
	const localRequire = createRequire(filename);
	const extensionModule: { exports: { activate?: (context: unknown) => void } } = { exports: {} };
	runInNewContext(readFileSync(filename, 'utf8'), {
		module: extensionModule, exports: extensionModule.exports,
		require: (name: string) => name === 'vscode' ? mockVscode : name === './utilityModels'
			? { UtilityModelDefaults: class { sync() { } dispose() { } } }
			: localRequire(name),
		TextEncoder, TextDecoder, AbortSignal,
		fetch: async (_url: string, options: { headers: { Authorization: string } }) => {
			discoveryHeaders.push(options.headers.Authorization);
			return { ok: true, json: async () => ({ data: [{ id: 'gpt-6-sol' }] }) };
		},
	}, { filename });
	extensionModule.exports.activate!(context);

	return {
		files, state, messages, logs, discoveryHeaders, nativeSecrets,
		get secretCreations() { return secretCreations; },
		set apiKey(value: string) { apiKey = value; },
		set failSecretCreation(value: boolean) { failSecretCreation = value; },
		set failGroupWrite(value: boolean) { failGroupWrite = value; },
		set failedFile(value: string) { failedFile = value; },
		set currentFile(value: string) { currentFile = value; },
		set onSecretCreation(value: () => void) { onSecretCreation = value; },
		sync: () => commands.get('wingman.syncModels')!(),
		group: (file = defaultFile): Group => JSON.parse(files.get(file)!).find((group: Group) => group.name === 'Wingman'),
	};
}

function wingmanGroup(): Group {
	return {
		name: 'Wingman', vendor: 'customendpoint', apiType: 'chat-completions',
		apiKey: '${input:chat.lm.secret.old}', models,
		settings: { 'gpt-6-sol': { reasoningEffort: 'high' } },
	};
}

suite('API key sync', () => {
	test('rotates the chat credential when only the API key changes', async () => {
		const app = harness();
		await app.sync();
		const originalReference = app.group().apiKey;
		app.apiKey = 'second-test-key';
		await app.sync();

		assert.notStrictEqual(app.group().apiKey, originalReference);
		assert.strictEqual(app.nativeSecrets.get(app.group().apiKey!), 'second-test-key');
		assert.strictEqual(app.discoveryHeaders.at(-1), 'Bearer second-test-key');
		assert.deepStrictEqual(app.group().models, models);
		assert.deepStrictEqual(app.group().settings, wingmanGroup().settings);
		assert.ok(!app.files.get(defaultFile)!.includes('test-key'));
		assert.ok(!JSON.stringify([...app.state, ...app.logs]).includes('test-key'));
	});

	test('reuses the saved credential and removes the temporary group', async () => {
		const app = harness();
		await app.sync();
		const content = app.files.get(defaultFile);
		const creations = app.secretCreations;
		await app.sync();
		assert.strictEqual(app.secretCreations, creations);
		assert.strictEqual(app.files.get(defaultFile), content);
		assert.strictEqual(JSON.parse(content!).length, 1);
	});

	test('updates all existing profiles and preserves unrelated groups', async () => {
		const unrelated = { name: 'Other', vendor: 'customendpoint', apiKey: '${input:other}' };
		const app = harness([unrelated, wingmanGroup()]);
		app.files.set(profileFile, JSON.stringify([wingmanGroup()]));
		await app.sync();
		assert.strictEqual(app.group(profileFile).apiKey, app.group().apiKey);
		assert.deepStrictEqual(JSON.parse(app.files.get(defaultFile)!)[0], unrelated);
	});

	test('normalizes an empty API key for discovery and chat', async () => {
		const app = harness();
		app.apiKey = '   ';
		await app.sync();
		assert.strictEqual(app.nativeSecrets.get(app.group().apiKey!), '-');
		assert.strictEqual(app.discoveryHeaders.at(-1), 'Bearer -');
	});

	test('reports secret failures without replacing the working group and retries', async () => {
		const app = harness();
		app.failSecretCreation = true;
		await app.sync();
		assert.deepStrictEqual(app.group(), wingmanGroup());
		assert.ok(app.messages.at(-1)?.includes('model sync failed'));
		app.failSecretCreation = false;
		await app.sync();
		assert.strictEqual(app.nativeSecrets.get(app.group().apiKey!), 'first-test-key');
	});

	test('reports a failed credential write instead of claiming the group is up to date', async () => {
		const app = harness();
		app.failGroupWrite = true;
		await app.sync();
		assert.deepStrictEqual(app.group(), wingmanGroup());
		assert.ok(app.messages.at(-1)?.includes('model sync failed'));
		const creations = app.secretCreations;
		app.failGroupWrite = false;
		await app.sync();
		assert.strictEqual(app.nativeSecrets.get(app.group().apiKey!), 'first-test-key');
		assert.strictEqual(app.secretCreations, creations);
	});

	test('reuses the first-install credential on subsequent syncs', async () => {
		const app = harness([]);
		await app.sync();
		const reference = app.group().apiKey;
		await app.sync();
		assert.strictEqual(app.group().apiKey, reference);
		assert.strictEqual(app.secretCreations, 1);
		assert.strictEqual(app.nativeSecrets.get(reference!), 'first-test-key');
	});

	test('repairs a partially updated set of profiles without creating another credential', async () => {
		const app = harness();
		app.files.set(profileFile, JSON.stringify([wingmanGroup()]));
		app.failedFile = profileFile;
		app.failGroupWrite = true;
		await app.sync();
		assert.notStrictEqual(app.group().apiKey, app.group(profileFile).apiKey);
		assert.ok(app.messages.at(-1)?.includes('model sync failed'));
		const creations = app.secretCreations;
		app.failGroupWrite = false;
		await app.sync();
		assert.strictEqual(app.secretCreations, creations);
		assert.strictEqual(app.group().apiKey, app.group(profileFile).apiKey);
	});

	test('seeds the current profile when only another profile contains Wingman', async () => {
		const app = harness([]);
		app.files.set(profileFile, JSON.stringify([wingmanGroup()]));
		await app.sync();
		assert.strictEqual(app.group().apiKey, app.group(profileFile).apiKey);
		assert.strictEqual(app.nativeSecrets.get(app.group().apiKey!), 'first-test-key');
		assert.strictEqual(app.secretCreations, 1);
		assert.strictEqual(JSON.parse(app.files.get(defaultFile)!).length, 1);
	});

	test('finds credentials created in a custom profile', async () => {
		const app = harness();
		app.currentFile = profileFile;
		app.files.set(profileFile, JSON.stringify([wingmanGroup()]));
		await app.sync();
		assert.strictEqual(app.group().apiKey, app.group(profileFile).apiKey);
		assert.strictEqual(app.nativeSecrets.get(app.group(profileFile).apiKey!), 'first-test-key');
		assert.strictEqual(JSON.parse(app.files.get(profileFile)!).length, 1);
	});

	test('preserves group changes made while the credential is being created', async () => {
		const app = harness();
		app.onSecretCreation = () => {
			const groups: Group[] = JSON.parse(app.files.get(defaultFile)!);
			groups[0].settings = { 'gpt-6-sol': { reasoningEffort: 'max' } };
			groups.push({ name: 'New group', vendor: 'customendpoint' });
			app.files.set(defaultFile, JSON.stringify(groups));
		};
		await app.sync();
		assert.deepStrictEqual(app.group().settings, { 'gpt-6-sol': { reasoningEffort: 'max' } });
		assert.strictEqual(JSON.parse(app.files.get(defaultFile)!).length, 2);
	});
});
