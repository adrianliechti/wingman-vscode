import * as vscode from 'vscode';
import { randomUUID } from 'node:crypto';

import { toCustomEndpointModels, CustomEndpointModel } from './models';
import { UtilityModelDefaults } from './utilityModels';

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

export function activate(context: vscode.ExtensionContext) {
	const logger = vscode.window.createOutputChannel('Wingman AI', { log: true });
	const utilityModels = new UtilityModelDefaults(groupVendor, logger);

	context.subscriptions.push(
		logger,
		utilityModels,
		vscode.commands.registerCommand('wingman.syncModels', () => syncModels(context, logger, utilityModels, true)),
	);

	// One-shot flag from older versions that made sync a write-once operation.
	void context.globalState.update('wingman.modelsSynced', undefined);

	// Sync on every startup so extension updates, backend model changes and
	// setting changes all reach the provider group. Unchanged state is
	// detected against the stored group and not rewritten.
	void syncModels(context, logger, utilityModels, false);
}

export function deactivate() { }

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
		const message = error instanceof Error ? error.message : String(error);

		logger.error('Model sync failed:', message);

		if (interactive) {
			void vscode.window.showErrorMessage(`Wingman: model sync failed — ${message}`);
		} else if (!context.globalState.get<boolean>(syncHintShownKey)) {
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
