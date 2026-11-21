import {
	chatReducer,
	rootReducer,
	sessionReducer,
	type ActionEnvelope,
	type ChatAction,
	type ChatState,
	type CommandMap,
	type RootAction,
	type RootState,
	type SessionAction,
	type SessionState,
	type Snapshot,
	type StateAction,
} from '@microsoft/agent-host-protocol';
import { AhpClient } from '@microsoft/agent-host-protocol/client';
import { WebSocketTransport } from '@microsoft/agent-host-protocol/ws';

import { rootChannel } from './values';

export type ChannelState = RootState | SessionState | ChatState;
/** `connection` tells states of one connection from those of an earlier one. */
export type ChannelUpdate = { state: ChannelState, connection: number };

type Observer = {
	listeners: Set<(update: ChannelUpdate) => void>;
	errors: Set<(error: Error) => void>;
	state?: ChannelState;
	seq: number;
	/** Actions that arrived before the channel's snapshot. */
	pending: ActionEnvelope[];
	generation: number;
};
type PendingAction = {
	resolve: () => void;
	reject: (error: Error) => void;
	timer: ReturnType<typeof setTimeout>;
};

const retryDelay = 1500;
const actionTimeout = 30_000;

/**
 * One connection to the agent host for every channel the panel watches. The
 * SDK owns RPC and wire types and its reducers own channel state.
 */
export class Connection {
	readonly clientId = crypto.randomUUID();
	private client?: AhpClient;
	private generation = 0;
	private stopped = true;
	private connected = false;
	private connecting?: Promise<void>;
	private timer?: ReturnType<typeof setTimeout>;
	private sequence = 0;
	private actions = new Map<number, PendingAction>();
	private observers = new Map<string, Observer>();
	private listeners = new Set<() => void>();

	constructor(private readonly address: string) { }

	readonly isConnected = () => this.connected;

	/** Called when the connection opens or closes. */
	onStatus(listener: () => void): () => void {
		this.listeners.add(listener);
		return () => { this.listeners.delete(listener); };
	}

	start(): void {
		if (!this.stopped) {
			return;
		}
		this.stopped = false;
		void this.ready().catch(() => { });
	}

	stop(): void {
		this.stopped = true;
		++this.generation;
		this.connecting = undefined;
		clearTimeout(this.timer);
		void this.client?.shutdown();
		this.client = undefined;
		this.failActions(new Error('Disconnected from the agent host.'));
		this.status(false);
	}

	/** Connects now instead of waiting for the next retry. */
	retry(): void {
		if (!this.stopped && !this.connected) {
			clearTimeout(this.timer);
			void this.ready().catch(() => { });
		}
	}

	private status(connected: boolean): void {
		if (this.connected !== connected) {
			this.connected = connected;
			for (const listener of [...this.listeners]) {
				listener();
			}
		}
	}

	private failActions(error: Error): void {
		for (const pending of this.actions.values()) {
			clearTimeout(pending.timer);
			pending.reject(error);
		}
		this.actions.clear();
	}

	private ready(): Promise<void> {
		if (this.stopped) {
			return Promise.reject(new Error('Disconnected from the agent host.'));
		}
		if (this.connected) {
			return Promise.resolve();
		}
		if (!this.connecting) {
			const connecting = this.connect().finally(() => {
				if (this.connecting === connecting) {
					this.connecting = undefined;
				}
			});
			this.connecting = connecting;
		}
		return this.connecting;
	}

	private async connect(): Promise<void> {
		const generation = ++this.generation;
		let client: AhpClient | undefined;
		try {
			const transport = await WebSocketTransport.connect(this.address);
			if (this.stopped || generation !== this.generation) {
				await transport.close();
				return;
			}
			client = new AhpClient(transport);
			this.client = client;
			const root = this.observe(rootChannel);
			root.state = undefined;
			root.pending = [];
			root.generation = generation;
			void this.follow(client);
			client.connect();
			const result = await client.initialize({
				clientId: this.clientId,
				protocolVersions: ['1.1.0', '1.0.0'],
				initialSubscriptions: [rootChannel],
			});
			if (this.client !== client || this.stopped || generation !== this.generation) {
				return;
			}
			const snapshot = result.snapshots?.find(candidate => candidate.resource === rootChannel);
			if (!snapshot) {
				throw new Error('The agent host did not provide its root state.');
			}
			this.snapshot(snapshot, root);
			this.status(true);
			// Channels watched before the connection opened, or over an earlier one.
			for (const [uri, observer] of this.observers) {
				if (uri !== rootChannel && observer.listeners.size && observer.generation !== generation) {
					void this.attach(uri, observer, generation);
				}
			}
		} catch (error) {
			await client?.shutdown();
			if (generation === this.generation) {
				this.client = undefined;
				this.status(false);
				this.schedule();
			}
			throw error;
		}
	}

	private async follow(client: AhpClient): Promise<void> {
		try {
			for await (const { event } of client.events()) {
				if (this.client !== client) {
					return;
				}
				if (event.type === 'action') {
					this.action(event.params);
				}
			}
		} catch {
			await client.shutdown();
		} finally {
			if (this.client === client) {
				this.client = undefined;
				this.status(false);
				this.failActions(new Error('Connection lost. Retry after reconnecting.'));
				this.schedule();
			}
		}
	}

	private schedule(): void {
		if (this.stopped) {
			return;
		}
		clearTimeout(this.timer);
		this.timer = setTimeout(() => { void this.ready().catch(() => { }); }, retryDelay);
	}

	private observe(uri: string): Observer {
		let observer = this.observers.get(uri);
		if (!observer) {
			observer = { listeners: new Set(), errors: new Set(), seq: -1, pending: [], generation: 0 };
			this.observers.set(uri, observer);
		}
		return observer;
	}

	/** Follows a channel's state across reconnects until the returned function is called. */
	watch(uri: string, listener: (update: ChannelUpdate) => void, onError?: (error: Error) => void): () => void {
		const observer = this.observe(uri);
		observer.listeners.add(listener);
		if (onError) {
			observer.errors.add(onError);
		}
		if (this.connected && observer.state && observer.generation === this.generation) {
			listener({ state: observer.state, connection: this.generation });
		} else if (this.connected && observer.generation !== this.generation) {
			void this.attach(uri, observer, this.generation);
		}
		return () => {
			observer.listeners.delete(listener);
			if (onError) {
				observer.errors.delete(onError);
			}
			if (!observer.listeners.size && uri !== rootChannel && this.observers.get(uri) === observer) {
				this.observers.delete(uri);
				void this.client?.unsubscribe(uri).catch(() => { });
			}
		};
	}

	private async attach(uri: string, observer: Observer, generation: number): Promise<void> {
		const client = this.client;
		if (!client) {
			return;
		}
		observer.generation = generation;
		observer.state = undefined;
		observer.pending = [];
		try {
			const result = await client.request('subscribe', { channel: uri });
			if (this.client !== client || this.observers.get(uri) !== observer) {
				return;
			}
			if (!result.snapshot) {
				throw new Error('The agent host did not provide the channel state.');
			}
			this.snapshot(result.snapshot, observer);
		} catch (error) {
			if (this.client === client && client.connectionState.status === 'connected' && this.observers.get(uri) === observer) {
				observer.generation = 0;
				for (const fail of [...observer.errors]) {
					fail(error instanceof Error ? error : new Error(String(error)));
				}
			}
		}
	}

	private snapshot(snapshot: Snapshot, observer: Observer): void {
		observer.state = snapshot.state as ChannelState;
		observer.seq = snapshot.fromSeq;
		const pending = observer.pending;
		observer.pending = [];
		for (const action of pending) {
			this.reduce(action, observer);
		}
		this.changed(observer);
	}

	private action(envelope: ActionEnvelope): void {
		// The host echoes this client's own actions, which confirms or rejects them.
		if (envelope.origin?.clientId === this.clientId) {
			const pending = this.actions.get(envelope.origin.clientSeq);
			if (pending) {
				this.actions.delete(envelope.origin.clientSeq);
				clearTimeout(pending.timer);
				if (envelope.rejectionReason !== undefined) {
					pending.reject(new Error(envelope.rejectionReason));
				} else {
					pending.resolve();
				}
			}
		}
		if (envelope.rejectionReason !== undefined) {
			return;
		}
		const observer = this.observers.get(envelope.channel);
		if (!observer || observer.generation !== this.generation) {
			return;
		}
		if (observer.state) {
			const previous = observer.state;
			this.reduce(envelope, observer);
			if (observer.state !== previous) {
				this.changed(observer);
			}
		} else if (observer.pending.length < 4096) {
			observer.pending.push(envelope);
		} else {
			void this.client?.shutdown(); // reconnecting reads the state again
		}
	}

	private reduce(envelope: ActionEnvelope, observer: Observer): void {
		if (envelope.serverSeq <= observer.seq || !observer.state) {
			return;
		}
		const { channel, action } = envelope;
		if (channel === rootChannel) {
			observer.state = rootReducer(observer.state as RootState, action as RootAction);
		} else if (channel.startsWith('ahp-chat:')) {
			observer.state = chatReducer(observer.state as ChatState, action as ChatAction);
		} else if (channel.startsWith('ahp-session:')) {
			observer.state = sessionReducer(observer.state as SessionState, action as SessionAction);
		}
		observer.seq = envelope.serverSeq;
	}

	private changed(observer: Observer): void {
		if (!observer.state) {
			return;
		}
		const update = { state: observer.state, connection: this.generation };
		for (const listener of [...observer.listeners]) {
			listener(update);
		}
	}

	private async open(): Promise<AhpClient> {
		await this.ready();
		// The connection can close between ready() settling and this continuation.
		if (!this.connected || !this.client) {
			throw new Error('Connection lost. Retry after reconnecting.');
		}
		return this.client;
	}

	async request<M extends keyof CommandMap>(method: M, params: CommandMap[M]['params']): Promise<CommandMap[M]['result']> {
		return (await this.open()).request(method, params);
	}

	/** Sends an action and settles once the host applied or rejected it. */
	async dispatch(channel: string, action: StateAction): Promise<void> {
		const client = await this.open();
		const seq = ++this.sequence;
		return new Promise<void>((resolve, reject) => {
			const timer = setTimeout(() => {
				this.actions.delete(seq);
				reject(new Error('The agent host did not confirm the action. Please retry.'));
			}, actionTimeout);
			this.actions.set(seq, { resolve, reject, timer });
			try {
				client.dispatch(channel, action, seq);
			} catch (error) {
				this.actions.delete(seq);
				clearTimeout(timer);
				reject(error instanceof Error ? error : new Error(String(error)));
			}
		});
	}
}
