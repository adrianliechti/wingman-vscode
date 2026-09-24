import * as vscode from 'vscode';

import { selectUtilityModels } from './models';

type UtilityModelSetting = 'utilityModel' | 'utilitySmallModel';

const settings: UtilityModelSetting[] = ['utilityModel', 'utilitySmallModel'];

/** Initializes utility model defaults and replaces selections that no longer resolve to a model. */
export class UtilityModelDefaults implements vscode.Disposable {
	private modelIds: readonly string[] = [];
	private pending: Promise<void> = Promise.resolve();
	private disposed = false;
	private readonly listener: vscode.Disposable;

	constructor(private readonly vendor: string, private readonly logger: vscode.LogOutputChannel) {
		this.listener = vscode.lm.onDidChangeChatModels(() => { void this.configure(); });
	}

	sync(modelIds: readonly string[]): Promise<void> {
		this.modelIds = modelIds;
		return this.configure();
	}

	dispose(): void {
		this.disposed = true;
		this.listener.dispose();
	}

	private configure(): Promise<void> {
		// Model registration events can overlap startup/manual sync; run the
		// settings writes one after another.
		this.pending = this.pending.then(() => this.configureModels()).catch(error => {
			this.logger.warn('Could not configure utility models:', error instanceof Error ? error.message : String(error));
		});
		return this.pending;
	}

	private async configureModels(): Promise<void> {
		if (this.disposed || this.modelIds.length === 0) {
			return;
		}

		const registered = new Set((await vscode.lm.selectChatModels({ vendor: this.vendor })).map(model => model.id));
		const defaults = selectUtilityModels(this.modelIds.filter(id => registered.has(id)));

		if (this.disposed || !defaults) {
			// A file-based group update may still be loading. The model change
			// listener retries once VS Code publishes the registered models.
			return;
		}

		for (const setting of settings) {
			for (const target of this.staleTargets(setting, registered)) {
				const value = `${this.vendor}/${defaults[setting]}`;
				await vscode.workspace.getConfiguration('chat').update(setting, value, target);
				this.logger.info(`Configured chat.${setting}:`, value);
			}
		}
	}

	/**
	 * Scopes whose value needs writing: the user scope when nothing is
	 * configured anywhere, otherwise only scopes that select a model of this
	 * vendor that is no longer registered — explicit choices, including
	 * Default ("") and other providers, are preserved.
	 */
	private staleTargets(setting: UtilityModelSetting, registered: ReadonlySet<string>): vscode.ConfigurationTarget[] {
		const value = vscode.workspace.getConfiguration('chat').inspect<string>(setting);
		const scopes: [vscode.ConfigurationTarget, string | undefined][] = [
			[vscode.ConfigurationTarget.Global, value?.globalValue],
			[vscode.ConfigurationTarget.Workspace, value?.workspaceValue],
		];

		if (scopes.every(([, configured]) => configured === undefined)) {
			return [vscode.ConfigurationTarget.Global];
		}

		const prefix = `${this.vendor}/`;
		return scopes
			.filter(([, configured]) => configured?.startsWith(prefix) && !registered.has(configured.slice(prefix.length)))
			.map(([target]) => target);
	}
}
