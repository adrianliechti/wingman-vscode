import * as vscode from 'vscode';

import { toCustomEndpointModels, CustomEndpointModel } from './models';
import { UtilityModelDefaults } from './utilityModels';

const groupName = 'Wingman';
const groupVendor = 'customendpoint';
const syncHintShownKey = 'wingman.syncHintShown';

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

		const { found, updated } = await updateGroupFiles(context, models, logger);

		// The migration command stores the API key as a new secret before it
		// rejects a duplicate group, so probing it on every startup would
		// leave an orphaned secret behind each time. Seed only when no profile
		// holds the group yet, or on explicit request so a profile that lacks
		// the group while another profile has it can still be seeded.
		const seeded = (found === 0 || interactive) && await seedGroup(apiKey, models);

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
async function seedGroup(apiKey: string, models: CustomEndpointModel[]): Promise<boolean> {
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
		return true;
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		if (!message.includes('already exists')) {
			throw error;
		}
		return false;
	}
}

/**
 * Rewrites the Wingman group in every chatLanguageModels.json that contains
 * it. The core "lm.*" commands can only add a provider group, never modify
 * one, so updates edit the files directly — VS Code watches them and
 * hot-reloads changed groups. Only apiType and models are replaced; the
 * stored apiKey is a "${input:chat.lm.secret.*}" reference into VS Code's
 * secret storage and a plaintext value there would break authentication.
 */
async function updateGroupFiles(context: vscode.ExtensionContext, models: CustomEndpointModel[], logger: vscode.LogOutputChannel): Promise<{ found: number, updated: number }> {
	let found = 0;
	let updated = 0;

	for (const uri of await languageModelsFiles(context)) {
		try {
			const groups: unknown = JSON.parse(new TextDecoder().decode(await vscode.workspace.fs.readFile(uri)));

			if (!Array.isArray(groups)) {
				continue;
			}

			const group = groups.find(g => g?.vendor === groupVendor && g?.name === groupName);

			if (!group) {
				continue;
			}

			found++;

			if (group.apiType === 'chat-completions' && JSON.stringify(group.models) === JSON.stringify(models)) {
				continue;
			}

			group.apiType = 'chat-completions';
			group.models = models;

			await vscode.workspace.fs.writeFile(uri, new TextEncoder().encode(JSON.stringify(groups, undefined, '\t')));
			logger.info('Updated language model group in', uri.fsPath);
			updated++;
		} catch (error) {
			if (error instanceof vscode.FileSystemError && error.code === 'FileNotFound') {
				continue;
			}
			logger.warn(`Could not update ${uri.fsPath}:`, error instanceof Error ? error.message : String(error));
		}
	}

	return { found, updated };
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
