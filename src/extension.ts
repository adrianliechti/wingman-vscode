import * as vscode from 'vscode';

import { toCustomEndpointModels } from './models';

const groupName = 'Wingman';
const groupVendor = 'customendpoint';
const syncedStateKey = 'wingman.modelsSynced';
const syncHintShownKey = 'wingman.syncHintShown';

export function activate(context: vscode.ExtensionContext) {
	const logger = vscode.window.createOutputChannel('Wingman AI', { log: true });

	context.subscriptions.push(
		logger,
		vscode.commands.registerCommand('wingman.syncModels', () => syncModels(context, logger, true)),
	);

	// One-time seeding of the built-in "Custom Endpoint" provider group.
	// Retried on the next startup if the backend was unreachable.
	if (!context.globalState.get<boolean>(syncedStateKey)) {
		void syncModels(context, logger, false);
	}
}

export function deactivate() { }

async function syncModels(context: vscode.ExtensionContext, logger: vscode.LogOutputChannel, interactive: boolean): Promise<void> {
	const config = vscode.workspace.getConfiguration('wingman');
	const baseUrl = config.get<string>('baseUrl', 'http://localhost:4242/v1').replace(/\/+$/, '');
	const apiKey = config.get<string>('apiKey', '-').trim() || '-';

	logger.info('Platform:', baseUrl);

	try {
		const models = toCustomEndpointModels(await listModelIds(baseUrl, apiKey), baseUrl);

		logger.info('Available models:', models.map(m => m.id).join(', ') || 'none');

		if (models.length === 0) {
			throw new Error('The Wingman backend reported no supported models.');
		}

		await vscode.commands.executeCommand('lm.migrateLanguageModelsProviderGroup', {
			name: groupName,
			vendor: groupVendor,
			apiKey,
			apiType: 'responses',
			models,
		});

		if (interactive) {
			void vscode.window.showInformationMessage(`Wingman: added ${models.length} model(s) to the "${groupName}" language model group.`);
		}
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);

		if (!message.includes('already exists')) {
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
						void syncModels(context, logger, true);
					}
				});
			}
			return;
		}

		// The group is already configured. Editing it programmatically is not
		// possible (core only exposes add/migrate), so point at the JSON file.
		logger.info(`Language model group "${groupName}" already exists, leaving it untouched.`);
		if (interactive) {
			const open = 'Open Language Models File';
			const choice = await vscode.window.showWarningMessage(
				`Wingman: a "${groupName}" group already exists. Remove or edit it manually, then run "Wingman: Sync Models" again.`,
				open,
			);
			if (choice === open) {
				void vscode.commands.executeCommand('workbench.action.openLanguageModelsJson');
			}
		}
	}

	await context.globalState.update(syncedStateKey, true);
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
