import type {
	AgentInfo,
	ChatInputAnswer,
	ChatInputRequest,
	ChatState,
	RootState,
	SessionConfigPropertySchema,
	SessionState,
	SessionSummary,
} from '@microsoft/agent-host-protocol';
import { RpcError } from '@microsoft/agent-host-protocol/client';

import type { SessionItem } from '../chatProtocol';
import { Connection } from './connection';
import {
	ActionType,
	ChatInputAnswerState,
	ChatInputAnswerValueKind,
	ChatInputResponseKind,
	MessageKind,
	PendingMessageKind,
	SessionStatus,
	ToolCallCancellationReason,
	ToolCallConfirmationReason,
	provider,
	rootChannel,
} from './values';

const sessionAlreadyExists = -32003;

export type Config = {
	properties: Record<string, SessionConfigPropertySchema>;
	values: Record<string, unknown>;
};

export type View = {
	/** The folder sessions work in, as a file URI. */
	directory?: string;
	/** Why no session can start here, such as a window without a folder. */
	notice?: string;
	connected: boolean;
	/** Wingman's own agent, once the host listed it. */
	agent?: AgentInfo;
	session?: SessionState;
	chat?: ChatState;
	/** A saved session is being opened. */
	opening: boolean;
	sending: boolean;
	/** The settings of the open chat, or those a new one starts with. */
	config?: Config;
	error?: string;
};

type Saved = { sessions?: Record<string, string>, projects?: Record<string, string> };

/** The panel's one chat: its connection, its open session and what the user does with it. */
export class Chat {
	private view: View = { connected: false, opening: false, sending: false };
	private listeners = new Set<() => void>();
	private connection?: Connection;
	private address?: string;
	private directory?: string;
	private sessionUri?: string;
	private chatUri?: string;
	private release = () => { };
	/** Settings chosen before the chat exists. */
	private draft: Record<string, unknown> = {};
	private resolving = 0;

	constructor(private readonly storage: { getState(): unknown, setState(state: unknown): void }) { }

	readonly subscribe = (listener: () => void) => {
		this.listeners.add(listener);
		return () => { this.listeners.delete(listener); };
	};
	readonly getView = () => this.view;

	private set(change: Partial<View>): void {
		this.view = { ...this.view, ...change };
		for (const listener of [...this.listeners]) {
			listener();
		}
	}

	private saved(): Saved {
		const state = this.storage.getState();
		return state && typeof state === 'object' ? state as Saved : {};
	}

	/** Remembers the folder's open session, so a reloaded panel shows it again. */
	private remember(): void {
		if (!this.directory) {
			return;
		}
		const saved = this.saved();
		const sessions = { ...saved.sessions };
		if (this.sessionUri) {
			sessions[this.directory] = this.sessionUri;
		} else {
			delete sessions[this.directory];
		}
		this.storage.setState({ ...saved, sessions });
	}

	init(address: string, directory: string | undefined, notice: string | undefined): void {
		if (address !== this.address) {
			this.connection?.stop();
			this.address = address;
			const connection = new Connection(address);
			this.connection = connection;
			connection.onStatus(() => {
				this.set({ connected: connection.isConnected() });
				if (connection.isConnected()) {
					void this.resolveDraft();
				}
			});
			connection.watch(rootChannel, update => {
				const agent = (update.state as RootState).agents.find(candidate => candidate.provider === provider);
				if (agent !== this.view.agent) {
					this.set({ agent });
				}
			});
			connection.start();
		}
		if (directory !== this.directory || notice !== this.view.notice) {
			this.close();
			this.directory = directory;
			this.draft = {};
			this.set({ directory, notice, error: undefined, config: undefined });
			const last = directory ? this.saved().sessions?.[directory] : undefined;
			if (last) {
				this.open(last).catch(() => { });
			} else {
				void this.resolveDraft();
			}
		}
	}

	dismiss(): void {
		this.set({ error: undefined });
	}

	/** Tries the host again now, for instance after it was started. */
	reconnect(): void {
		this.connection?.retry();
	}

	private close(): void {
		this.release();
		this.release = () => { };
		this.sessionUri = undefined;
		this.chatUri = undefined;
		this.set({ session: undefined, chat: undefined, opening: false });
	}

	newChat(): void {
		this.close();
		this.remember();
		this.draft = {};
		this.set({ error: undefined, config: undefined });
		void this.resolveDraft();
	}

	openSession(uri: string): void {
		if (uri !== this.sessionUri) {
			this.open(uri).catch(() => { });
		}
	}

	/** Watches a session and its chat; settles once both states arrived. */
	private open(uri: string): Promise<void> {
		const connection = this.connection;
		if (!connection) {
			return Promise.reject(new Error('Not connected to the agent host.'));
		}
		this.close();
		this.sessionUri = uri;
		this.remember();
		this.set({ opening: true, error: undefined });
		return new Promise<void>((resolve, reject) => {
			let session: SessionState | undefined;
			let chat: ChatState | undefined;
			let sessionConnection = -1;
			let chatConnection = -2;
			let releaseChat = () => { };
			const current = () => this.sessionUri === uri;
			const gone = (message: string) => {
				if (!current()) {
					return;
				}
				this.newChat();
				this.set({ error: message });
				reject(new Error(message));
			};
			const update = () => {
				// States of two connections describe different moments.
				if (!current() || !session || !chat || sessionConnection !== chatConnection) {
					return;
				}
				this.set({ session, chat, opening: false, config: liveConfig(session, chat) });
				resolve();
			};
			const releaseSession = connection.watch(uri, next => {
				session = next.state as SessionState;
				sessionConnection = next.connection;
				if (session.project?.uri && this.directory) {
					const saved = this.saved();
					this.storage.setState({ ...saved, projects: { ...saved.projects, [this.directory]: session.project.uri } });
				}
				if (!this.chatUri && current()) {
					const chatUri = session.defaultChat ?? sessionToChat(uri);
					this.chatUri = chatUri;
					releaseChat = connection.watch(chatUri, nextChat => {
						chat = nextChat.state as ChatState;
						chatConnection = nextChat.connection;
						update();
					}, error => gone(`Could not open the session: ${error.message}`));
				}
				// A disposed session lists no chats.
				if (this.chatUri && !session.chats.some(summary => summary.resource === this.chatUri)) {
					gone('This session was deleted.');
				} else if (session.creationError) {
					gone(session.creationError.message);
				} else {
					update();
				}
			}, error => gone(`Could not open the session: ${error.message}`));
			const release = () => {
				releaseSession();
				releaseChat();
			};
			// The session may have been given up while its first state arrived.
			if (current()) {
				this.release = release;
			} else {
				release();
			}
		});
	}

	/** The settings a new chat would start with, as the host resolves them. */
	private async resolveDraft(): Promise<void> {
		const connection = this.connection;
		if (!connection?.isConnected() || !this.directory || this.sessionUri) {
			return;
		}
		const attempt = ++this.resolving;
		try {
			const result = await connection.request('resolveSessionConfig', {
				channel: rootChannel,
				provider,
				workingDirectory: this.directory,
				config: this.draft,
			});
			if (attempt === this.resolving && !this.sessionUri) {
				this.set({ config: { properties: result.schema.properties, values: result.values } });
			}
		} catch (error) {
			if (attempt === this.resolving && !this.sessionUri) {
				this.set({ error: text(error) });
			}
		}
	}

	private async create(): Promise<void> {
		const connection = this.connection!;
		const uri = `ahp-session:/${crypto.randomUUID()}`;
		try {
			await connection.request('createSession', {
				channel: uri,
				provider,
				workingDirectories: [this.directory!],
				...(Object.keys(this.draft).length ? { config: this.draft } : {}),
			});
		} catch (error) {
			// A repeated request finds the session the first one created.
			if (!(error instanceof RpcError && error.code === sessionAlreadyExists)) {
				throw error;
			}
		}
		await this.open(uri);
	}

	async send(message: string): Promise<boolean> {
		const connection = this.connection;
		if (!connection || !this.directory || this.view.sending) {
			return false;
		}
		this.set({ sending: true, error: undefined });
		try {
			if (!this.sessionUri) {
				await this.create();
			}
			if (!this.chatUri) {
				throw new Error('The session is still opening. Please retry.');
			}
			// A chat that runs a turn keeps the message until that turn ends.
			await connection.dispatch(this.chatUri, {
				type: ActionType.ChatPendingMessageSet,
				kind: PendingMessageKind.Queued,
				id: crypto.randomUUID(),
				message: { text: message, origin: { kind: MessageKind.User } },
			});
			return true;
		} catch (error) {
			this.set({ error: text(error) });
			return false;
		} finally {
			this.set({ sending: false });
		}
	}

	/** Stops the running turn; the host drops the messages queued behind it. */
	async cancel(): Promise<void> {
		const chat = this.view.chat;
		const turnId = chat?.activeTurn?.id;
		if (!chat || !turnId) {
			return;
		}
		try {
			await this.connection!.dispatch(chat.resource, { type: ActionType.ChatTurnCancelled, turnId, duration: 0 });
		} catch (error) {
			// Stopping succeeded if the turn ended first.
			if (this.view.chat?.activeTurn?.id === turnId) {
				this.set({ error: text(error) });
			}
		}
	}

	/** Answers a tool call that waits for approval, with one of its options if it has any. */
	async confirm(toolCallId: string, approve: boolean, optionId?: string): Promise<void> {
		const chat = this.view.chat;
		const turn = chat?.activeTurn;
		const part = turn?.responseParts.find(candidate => candidate.kind === 'toolCall' && candidate.toolCall.toolCallId === toolCallId);
		if (!chat || !turn || part?.kind !== 'toolCall' || part.toolCall.status !== 'pending-confirmation') {
			return;
		}
		const options = part.toolCall.options ?? [];
		const option = options.find(candidate => candidate.id === optionId)
			?? options.find(candidate => candidate.kind === (approve ? 'approve' : 'deny'));
		const approved = option ? option.kind === 'approve' : approve;
		try {
			await this.connection!.dispatch(chat.resource, {
				type: ActionType.ChatToolCallConfirmed,
				turnId: turn.id,
				toolCallId,
				...(approved
					? { approved: true, confirmed: ToolCallConfirmationReason.UserAction }
					: { approved: false, reason: ToolCallCancellationReason.Denied }),
				...(option ? { selectedOptionId: option.id } : {}),
			});
		} catch (error) {
			this.set({ error: text(error) });
		}
	}

	/** Answers a question of the agent, or declines it when `content` is omitted. */
	async answer(request: ChatInputRequest, content?: Record<string, unknown>): Promise<void> {
		const chat = this.view.chat;
		if (!chat) {
			return;
		}
		try {
			await this.connection!.dispatch(chat.resource, {
				type: ActionType.ChatInputCompleted,
				requestId: request.id,
				response: content ? ChatInputResponseKind.Accept : ChatInputResponseKind.Decline,
				answers: inputAnswers(request, content ?? {}),
			});
		} catch (error) {
			this.set({ error: text(error) });
		}
	}

	async configure(name: string, value: unknown): Promise<void> {
		const chat = this.view.chat;
		if (!chat) {
			this.draft = { ...this.draft, [name]: value };
			if (this.view.config) {
				this.set({ config: { ...this.view.config, values: { ...this.view.config.values, [name]: value } } });
			}
			await this.resolveDraft();
			return;
		}
		try {
			await this.connection!.dispatch(chat.resource, { type: ActionType.ChatConfigChanged, config: { [name]: value } });
		} catch (error) {
			this.set({ error: text(error) });
		}
	}

	/** Wingman's sessions of this folder, newest first. */
	async listSessions(): Promise<SessionItem[]> {
		const connection = this.connection;
		const directory = this.directory;
		if (!connection || !directory) {
			return [];
		}
		const result = await connection.request('listSessions', { channel: rootChannel });
		// Sessions name their project with links resolved, which this folder's path may not be.
		const folders = [directory, this.saved().projects?.[directory]].filter((uri): uri is string => !!uri).map(pathOf);
		const here = (summary: SessionSummary) =>
			[summary.project?.uri, ...(summary.workingDirectories ?? [])].some(uri => uri !== undefined && folders.includes(pathOf(uri)));
		return result.items
			.filter(summary => summary.provider === provider && here(summary))
			.sort((a, b) => b.modifiedAt.localeCompare(a.modifiedAt))
			.map(summary => ({
				uri: summary.resource,
				title: summary.title,
				modifiedAt: summary.modifiedAt,
				running: (summary.status & SessionStatus.InProgress) !== 0,
				current: summary.resource === this.sessionUri,
			}));
	}
}

/** A default chat shares its session's path. */
function sessionToChat(uri: string): string {
	return uri.replace(/^ahp-session:/, 'ahp-chat:');
}

/** A file URI's path, so that differently encoded URIs of one folder compare equal. */
function pathOf(uri: string): string {
	try {
		const path = decodeURIComponent(new URL(uri).pathname).replace(/\/+$/, '');
		return /^\/[a-zA-Z]:/.test(path) ? path.toLowerCase() : path;
	} catch {
		return uri;
	}
}

function liveConfig(session: SessionState, chat: ChatState): Config {
	return {
		properties: chat.config?.schema?.properties ?? session.config?.schema.properties ?? {},
		// Session values are the default chat's; a chat's own values win.
		values: { ...session.config?.values, ...chat.config?.values },
	};
}

export function text(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}

/** The host sends some texts plain and some as Markdown. */
export function display(value: string | { markdown: string } | undefined): string {
	return typeof value === 'string' ? value : value?.markdown ?? '';
}

export type Option = { id: string, label: string };
export type Settings = {
	model: string;
	models: Option[];
	effort: string;
	efforts: Option[];
	mode: string;
	modes: Option[];
};

function options(property?: { enum?: unknown[], enumLabels?: string[] }): Option[] {
	return (property?.enum ?? []).map((value, index) => ({ id: String(value), label: property?.enumLabels?.[index] || String(value) }));
}

/** What the pickers offer: the schema lists the choices, the agent's catalogue describes its models. */
export function settings(config: Config | undefined, agent: AgentInfo | undefined): Settings {
	const properties = config?.properties ?? {};
	const value = (name: string) => String(config?.values[name] ?? properties[name]?.default ?? '');
	const catalogue = agent?.models ?? [];
	const listed = options(properties.model);
	const models = listed.length
		? listed.map(option => ({ id: option.id, label: option.label !== option.id ? option.label : catalogue.find(model => model.id === option.id)?.name ?? option.id }))
		: catalogue.map(model => ({ id: model.id, label: model.name || model.id }));
	const model = value('model');
	// A model may support fewer effort levels than the agent offers.
	const own = options(catalogue.find(candidate => candidate.id === model)?.configSchema?.properties.effort);
	return {
		model,
		models,
		effort: value('effort'),
		efforts: own.length ? own : options(properties.effort),
		mode: value('mode'),
		modes: options(properties.mode),
	};
}

function inputAnswers(request: ChatInputRequest, content: Record<string, unknown>): Record<string, ChatInputAnswer> {
	const answers: Record<string, ChatInputAnswer> = Object.create(null);
	for (const question of request.questions ?? []) {
		const value = content[question.id];
		if (value === undefined) {
			continue;
		}
		const state = ChatInputAnswerState.Submitted;
		switch (question.kind) {
			case 'boolean':
				answers[question.id] = { state, value: { kind: ChatInputAnswerValueKind.Boolean, value: Boolean(value) } };
				break;
			case 'number':
			case 'integer':
				answers[question.id] = { state, value: { kind: ChatInputAnswerValueKind.Number, value: Number(value) } };
				break;
			case 'single-select': {
				const chosen = String(value);
				const listed = question.options.some(option => option.id === chosen);
				answers[question.id] = {
					state,
					value: { kind: ChatInputAnswerValueKind.Selected, value: listed ? chosen : '', ...(listed ? {} : { freeformValues: [chosen] }) },
				};
				break;
			}
			case 'multi-select': {
				const values = (Array.isArray(value) ? value : [value]).map(String);
				const listed = values.filter(candidate => question.options.some(option => option.id === candidate));
				answers[question.id] = {
					state,
					value: { kind: ChatInputAnswerValueKind.SelectedMany, value: listed, freeformValues: values.filter(candidate => !listed.includes(candidate)) },
				};
				break;
			}
			default:
				answers[question.id] = { state, value: { kind: ChatInputAnswerValueKind.Text, value: String(value) } };
		}
	}
	return answers;
}
