import * as vscode from 'vscode';
import { randomUUID } from 'node:crypto';

import { toCustomEndpointModels, CustomEndpointModel } from './models';
import { UtilityModelDefaults } from './utilityModels';
import { WingmanAgentHost } from './agentHost';
import { WingmanChatView, chatViewId } from './chatView';

const groupName = 'Wingman';
const groupVendor = 'customendpoint';
const syncHintShownKey = 'wingman.syncHintShown';
const syncedApiKeySecret = 'wingman.syncedApiKey';

type LanguageModelGroup = {
	name: string;
	vendor: string;
	apiKey?: unknown;
	apiType?: string;
	models?: CustomEndpointModel[];
};

let pendingSync: Promise<void> = Promise.resolve();
let agentHost: WingmanAgentHost | undefined;
let waitingForModelProvider = false;

export function activate(context: vscode.ExtensionContext) {
	const logger = vscode.window.createOutputChannel('Wingman AI', { log: true });
	const utilityModels = new UtilityModelDefaults(groupVendor, logger);
	agentHost = new WingmanAgentHost(logger);
	// The panel shows that it connected, so only a failed start needs a message.
	const chatView = new WingmanChatView(context.extensionUri, logger, () => agentHost?.start(true, false) ?? Promise.resolve());
	const retryModelProvider = () => {
		if (waitingForModelProvider) {
			waitingForModelProvider = false;
			void syncModels(context, logger, utilityModels, false);
		}
	};

	context.subscriptions.push(
		logger,
		utilityModels,
		agentHost,
		chatView,
		// The hidden panel keeps its connection, so a running turn is not missed.
		vscode.window.registerWebviewViewProvider(chatViewId, chatView, { webviewOptions: { retainContextWhenHidden: true } }),
		vscode.commands.registerCommand('wingman.openChat', () => vscode.commands.executeCommand(`${chatViewId}.focus`)),
		vscode.commands.registerCommand('wingman.newChat', () => chatView.newChat()),
		vscode.commands.registerCommand('wingman.chatHistory', () => chatView.showHistory()),
		vscode.commands.registerCommand('wingman.syncModels', () => syncModels(context, logger, utilityModels, true)),
		vscode.commands.registerCommand('wingman.startAgentHost', () => agentHost?.start()),
		vscode.commands.registerCommand('wingman.stopAgentHost', () => agentHost?.stop()),
		vscode.extensions.onDidChange(retryModelProvider),
		vscode.lm.onDidChangeChatModels(retryModelProvider),
	);

	// One-shot flag from older versions that made sync a write-once operation.
	void context.globalState.update('wingman.modelsSynced', undefined);

	// Sync on every startup so extension updates, backend model changes and
	// setting changes all reach the provider group. Unchanged state is
	// detected against the stored group and not rewritten.
	void syncModels(context, logger, utilityModels, false);
	void agentHost.configure();
}

export function deactivate() { return agentHost?.shutdown(); }

function syncModels(context: vscode.ExtensionContext, logger: vscode.LogOutputChannel, utilityModels: UtilityModelDefaults, interactive: boolean): Promise<void> {
	// The startup sync, the manual command and the retry button can overlap.
	// Run them one after another so each reports its own outcome and no two
	// migrations race for the same group.
	pendingSync = pendingSync.then(() => doSyncModels(context, logger, utilityModels, interactive));
	return pendingSync;
}

async function doSyncModels(context: vscode.ExtensionContext, logger: vscode.LogOutputChannel, utilityModels: UtilityModelDefaults, interactive: boolean): Promise<void> {
	const config = vscode.workspace.getConfiguration('wingman');
	const baseUrl = config.get<string>('baseUrl', 'http://localhost:4242/v1').replace(/\/+$/, '');
	const apiKey = config.get<string>('apiKey', '-').trim() || '-';

	logger.info('Platform:', baseUrl);

	try {
		await activateModelProvider();
		const { models, unmatched } = toCustomEndpointModels(await listModelIds(baseUrl, apiKey), baseUrl);

		logger.info('Available models:', models.map(m => m.id).join(', ') || 'none');

		if (unmatched.length > 0) {
			logger.info('Ignored models without a known configuration:', unmatched.join(', '));
		}

		if (models.length === 0) {
			throw new Error('The Wingman backend reported no supported models.');
		}

		const { found, updated } = await updateGroupFiles(context, models, apiKey, logger);

		// A manual sync also seeds the current profile if only other profiles
		// contain Wingman. Omit the key when probing an existing installation:
		// the command creates a secret even when it rejects a duplicate group.
		const seeded = (found === 0 || interactive) && await seedGroup(context, found === 0 ? apiKey : undefined, models);
		if (seeded && found > 0) {
			await updateGroupFiles(context, models, apiKey, logger);
		}

		if (found === 0 && !seeded) {
			// The group exists (migration refused to add it again) but no
			// chatLanguageModels.json containing it was found — e.g. a remote
			// extension host, where the file lives on the client.
			logger.warn(`Language model group "${groupName}" exists but its chatLanguageModels.json was not found, leaving it untouched.`);
			if (interactive) {
				const open = 'Open Language Models File';
				const choice = await vscode.window.showWarningMessage(
					`Wingman: the "${groupName}" group could not be updated automatically. Edit it manually, or remove it and run "Wingman: Sync Models" again.`,
					open,
				);
				if (choice === open) {
					void vscode.commands.executeCommand('workbench.action.openLanguageModelsJson');
				}
			}
			return;
		}

		await utilityModels.sync(models.map(model => model.id));

		if (interactive) {
			const summary = seeded
				? `added ${models.length} model(s) to the "${groupName}" language model group.`
				: updated > 0
					? `updated the "${groupName}" language model group to ${models.length} model(s).`
					: `the "${groupName}" language model group is already up to date.`;
			void vscode.window.showInformationMessage(`Wingman: ${summary}`);
		}
	} catch (error) {
		let message = error instanceof Error ? error.message : String(error);
		if (isModelProviderUnavailable(message)) {
			waitingForModelProvider = true;
			message = 'VS Code has not registered the Custom Endpoint provider. Enable GitHub Copilot Chat and check that BYOK models are allowed by your Copilot policy, then run Wingman: Sync Models.';
		}

		logger.error('Model sync failed:', message);

		if (interactive) {
			void vscode.window.showErrorMessage(`Wingman: model sync failed — ${message}`);
		} else if (!waitingForModelProvider && !context.globalState.get<boolean>(syncHintShownKey)) {
			// Surface the very first auto-sync failure so a fresh install
			// is not a silent no-op; afterwards only the log channel reports.
			void context.globalState.update(syncHintShownKey, true);
			const retry = 'Retry';
			void vscode.window.showWarningMessage(
				`Wingman: could not load models from ${baseUrl} — ${message}. Start your Wingman backend, then retry or run "Wingman: Sync Models".`,
				retry,
			).then(choice => {
				if (choice === retry) {
					void syncModels(context, logger, utilityModels, true);
				}
			});
		}
	}
}

async function activateModelProvider(): Promise<void> {
	const copilot = vscode.extensions.getExtension('GitHub.copilot-chat');
	if (!copilot) {
		waitingForModelProvider = true;
		throw new Error('Install or enable GitHub Copilot Chat (GitHub.copilot-chat) to use Wingman models in Copilot. The Wingman agent host can be used independently.');
	}
	try {
		await copilot.activate();
	} catch (error) {
		waitingForModelProvider = true;
		throw new Error(`Could not activate GitHub Copilot Chat: ${error instanceof Error ? error.message : String(error)}. Check its Output log, then retry Wingman: Sync Models.`);
	}
	waitingForModelProvider = false;
}

function isModelProviderUnavailable(message: string): boolean {
	return message.includes('Vendor customendpoint not found') || message.includes('Chat model provider for vendor customendpoint is not registered');
}

/**
 * Seeds the provider group in the current profile via the core migration
 * command, which moves the API key into VS Code's secret storage. Returns
 * true if the group was newly created, false if it already existed — the
 * command is strictly add-only and rejects a second registration.
 */
async function seedGroup(context: vscode.ExtensionContext, apiKey: string | undefined, models: CustomEndpointModel[]): Promise<boolean> {
	try {
		// Group-level fallback only — every model carries an explicit apiType:
		// "responses" for OpenAI, "messages" for Anthropic, "chat-completions"
		// for third-party models.
		await vscode.commands.executeCommand('lm.migrateLanguageModelsProviderGroup', {
			name: groupName,
			vendor: groupVendor,
			apiKey,
			apiType: 'chat-completions',
			models,
		});
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		if (!message.includes('already exists')) {
			throw error;
		}
		return false;
	}

	// Remember the native credential created on first install so the next
	// sync can reuse it instead of creating a second one.
	if (apiKey !== undefined) {
		for (const uri of await languageModelsFiles(context)) {
			const group = (await readGroups(uri))?.find(isWingmanGroup);
			if (isApiKeyReference(group?.apiKey)) {
				await context.secrets.store(syncedApiKeySecret, JSON.stringify({ apiKey, reference: group.apiKey }));
				break;
			}
		}
	}
	return true;
}

function isWingmanGroup(group: LanguageModelGroup): boolean {
	return group?.vendor === groupVendor && group?.name === groupName;
}

function isApiKeyReference(value: unknown): value is string {
	return typeof value === 'string' && /^\$\{input:chat\.lm\.secret\.[^}]+\}$/.test(value);
}

async function readGroups(uri: vscode.Uri): Promise<LanguageModelGroup[] | undefined> {
	try {
		const groups: unknown = JSON.parse(new TextDecoder().decode(await vscode.workspace.fs.readFile(uri)));
		if (!Array.isArray(groups)) {
			throw new Error('Language model configuration must be an array.');
		}
		return groups;
	} catch (error) {
		if (error instanceof vscode.FileSystemError && error.code === 'FileNotFound') {
			return undefined;
		}
		throw error;
	}
}

/**
 * Rewrites the Wingman group in every chatLanguageModels.json that contains
 * it. The core "lm.*" commands can only add a provider group, never modify
 * one, so updates edit the files directly — VS Code watches them and
 * hot-reloads changed groups. The API key must remain a reference to VS
 * Code's secret storage: a plaintext value would break authentication.
 */
async function updateGroupFiles(context: vscode.ExtensionContext, models: CustomEndpointModel[], apiKey: string, logger: vscode.LogOutputChannel): Promise<{ found: number, updated: number }> {
	let found = 0;
	let updated = 0;
	const failures: string[] = [];
	const files = await languageModelsFiles(context);
	let apiKeyReference: string | undefined;

	for (const uri of files) {
		try {
			let groups = await readGroups(uri);
			let group = groups?.find(isWingmanGroup);

			if (!group) {
				continue;
			}

			found++;
			if (!apiKeyReference) {
				apiKeyReference = await languageModelApiKey(context, apiKey);
				// Creating the credential edits the current profile. Read it again
				// so this write preserves changes made while the command ran.
				groups = await readGroups(uri);
				group = groups?.find(isWingmanGroup);
				if (!group) {
					throw new Error('Wingman group was removed during sync.');
				}
			}

			if (group.apiKey === apiKeyReference && group.apiType === 'chat-completions' && JSON.stringify(group.models) === JSON.stringify(models)) {
				continue;
			}

			group.apiKey = apiKeyReference;
			group.apiType = 'chat-completions';
			group.models = models;

			await vscode.workspace.fs.writeFile(uri, new TextEncoder().encode(JSON.stringify(groups, undefined, '\t')));
			logger.info('Updated language model group in', uri.fsPath);
			updated++;
		} catch (error) {
			if (isModelProviderUnavailable(error instanceof Error ? error.message : String(error))) {
				throw error; // Provider availability affects every profile; preserve the cause for retry.
			}
			logger.warn(`Could not update ${uri.fsPath}:`, error instanceof Error ? error.message : String(error));
			failures.push(uri.fsPath);
		}
	}

	if (failures.length > 0) {
		throw new Error(`Could not update language model configuration: ${failures.join(', ')}`);
	}

	return { found, updated };
}

/**
 * The core commands can create a secret but cannot replace one. Create an
 * empty temporary group to obtain a native secret reference, then remove
 * just that group from the file. Keep the key/reference pair in extension
 * secret storage so unchanged syncs do not create more secrets.
 */
async function languageModelApiKey(context: vscode.ExtensionContext, apiKey: string): Promise<string> {
	const saved = await context.secrets.get(syncedApiKeySecret);
	if (saved) {
		const cached = JSON.parse(saved) as { apiKey: string, reference: string };
		if (cached.apiKey === apiKey && isApiKeyReference(cached.reference)) {
			return cached.reference;
		}
	}

	const name = `Wingman API key ${randomUUID()}`;
	await vscode.commands.executeCommand('lm.addLanguageModelsProviderGroup', {
		name,
		vendor: groupVendor,
		apiKey,
		models: [],
	});

	// Re-enumerate in case the command created a profile's first model file.
	for (const uri of await languageModelsFiles(context)) {
		const groups = await readGroups(uri);
		if (!groups) {
			continue;
		}
		const index = groups.findIndex(group => group?.vendor === groupVendor && group?.name === name);
		if (index === -1) {
			continue;
		}

		const reference: unknown = groups[index].apiKey;
		groups.splice(index, 1);
		await vscode.workspace.fs.writeFile(uri, new TextEncoder().encode(JSON.stringify(groups, undefined, '\t')));
		if (!isApiKeyReference(reference)) {
			throw new Error('VS Code did not create a language model API key secret.');
		}
		await context.secrets.store(syncedApiKeySecret, JSON.stringify({ apiKey, reference }));
		return reference;
	}

	throw new Error('Could not locate the language model API key configuration on this extension host.');
}

/**
 * Possible locations of chatLanguageModels.json. Extension global storage
 * always lives in the default profile, so two levels up is the user data
 * directory: the default profile keeps its file there, custom profiles keep
 * their own copy under profiles/<id>/. Not every candidate exists.
 */
async function languageModelsFiles(context: vscode.ExtensionContext): Promise<vscode.Uri[]> {
	const userDir = vscode.Uri.joinPath(context.globalStorageUri, '..', '..');
	const files = [vscode.Uri.joinPath(userDir, 'chatLanguageModels.json')];

	try {
		for (const [name, type] of await vscode.workspace.fs.readDirectory(vscode.Uri.joinPath(userDir, 'profiles'))) {
			if (type === vscode.FileType.Directory) {
				files.push(vscode.Uri.joinPath(userDir, 'profiles', name, 'chatLanguageModels.json'));
			}
		}
	} catch {
		// no custom profiles
	}

	return files;
}

async function listModelIds(baseUrl: string, apiKey: string): Promise<string[]> {
	const response = await fetch(`${baseUrl}/models`, {
		headers: { 'Authorization': `Bearer ${apiKey}` },
		signal: AbortSignal.timeout(10_000),
	});

	if (!response.ok) {
		throw new Error(`GET ${baseUrl}/models failed: ${response.status} ${response.statusText}`);
	}

	const payload = await response.json() as { data?: { id?: unknown }[] };

	return (payload.data ?? [])
		.map(model => model.id)
		.filter((id): id is string => typeof id === 'string');
}
