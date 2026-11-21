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
import { AhpClient, type AhpTransport } from '@microsoft/agent-host-protocol/client';
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
	seq: number;
	resolve: () => void;
	reject: (error: Error) => void;
	timer: ReturnType<typeof setTimeout>;
};

const retryDelay = 1500;
const actionTimeout = 30_000;

/**
 * One connection to the agent host for every channel the panel watches. The
 * SDK owns RPC and wire types and its reducers own channel state. Actions are
 * read at the transport, in the order the host sent them, so a channel's state
 * never depends on how fast a consumer drains an event queue.
 */
export class Connection {
	readonly clientId = crypto.randomUUID();
	root: RootState = { agents: [] };
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
			const transport: AhpTransport = await WebSocketTransport.connect(this.address);
			if (this.stopped || generation !== this.generation) {
				await transport.close();
				return;
			}
			const tapped: AhpTransport = {
				send: message => transport.send(message),
				close: () => transport.close(),
				recv: async () => {
					const frame = await transport.recv();
					if (!frame || generation !== this.generation) {
						return frame;
					}
					let message;
					try {
						message = frame.kind === 'parsed'
							? frame.message
							: JSON.parse(frame.kind === 'text' ? frame.text : new TextDecoder().decode(frame.data));
					} catch {
						return frame; // the SDK reports malformed frames itself
					}
					if (message.method === 'action') {
						this.action(message.params as ActionEnvelope);
					}
					// Hand the SDK the parsed message so it is not parsed twice.
					return { kind: 'parsed', message };
				},
			};
			client = new AhpClient(tapped);
			this.client = client;
			const states = client.stateChanges();
			void (async () => {
				for await (const state of states) {
					if (state.status === 'closed' && generation === this.generation) {
						this.client = undefined;
						this.status(false);
						this.failActions(new Error('Connection lost. Retry after reconnecting.'));
						this.schedule();
					}
				}
			})();
			client.connect();
			const root = this.observe(rootChannel);
			root.state = undefined;
			root.pending = [];
			root.generation = generation;
			const result = await client.initialize({
				clientId: this.clientId,
				protocolVersions: ['1.1.0', '1.0.0'],
				initialSubscriptions: [rootChannel],
			});
			if (this.stopped || generation !== this.generation) {
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
		let released = false;
		return () => {
			if (released) {
				return;
			}
			released = true;
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
		observer.generation = generation;
		observer.state = undefined;
		observer.pending = [];
		try {
			const result = await this.client!.request('subscribe', { channel: uri });
			if (generation !== this.generation || this.observers.get(uri) !== observer) {
				return;
			}
			if (!result.snapshot) {
				throw new Error('The agent host did not provide the channel state.');
			}
			this.snapshot(result.snapshot, observer);
		} catch (error) {
			if (generation === this.generation && this.connected && this.observers.get(uri) === observer) {
				observer.generation = 0;
				for (const fail of [...observer.errors]) {
					fail(error instanceof Error ? error : new Error(String(error)));
				}
			}
		}
	}

	/** The current state of a channel, subscribing to it for as long as that takes. */
	read<T extends ChannelState>(uri: string): Promise<T> {
		return new Promise<T>((resolve, reject) => {
			let release = () => { };
			let done = false;
			const finish = (error?: Error, state?: ChannelState) => {
				if (done) {
					return;
				}
				done = true;
				clearTimeout(timer);
				queueMicrotask(() => release());
				if (error) {
					reject(error);
				} else {
					resolve(state as T);
				}
			};
			const timer = setTimeout(() => finish(new Error('The agent host did not answer. Please retry.')), actionTimeout);
			release = this.watch(uri, update => finish(undefined, update.state), error => finish(error));
		});
	}

	private snapshot(snapshot: Snapshot, observer: Observer): void {
		observer.state = snapshot.state as ChannelState;
		observer.seq = snapshot.fromSeq;
		this.changed(snapshot.resource, observer);
		const pending = observer.pending;
		observer.pending = [];
		for (const action of pending) {
			this.reduce(action, observer);
		}
	}

	private action(envelope: ActionEnvelope): void {
		// The host echoes this client's own actions, which confirms or rejects them.
		if (envelope.origin?.clientId === this.clientId) {
			const pending = this.actions.get(envelope.origin.clientSeq);
			if (pending) {
				this.actions.delete(envelope.origin.clientSeq);
				clearTimeout(pending.timer);
				if (envelope.rejectionReason) {
					pending.reject(new Error(envelope.rejectionReason));
				} else {
					pending.resolve();
				}
			}
		}
		if (envelope.rejectionReason) {
			return;
		}
		const observer = this.observers.get(envelope.channel);
		if (!observer || observer.generation !== this.generation) {
			return;
		}
		if (observer.state) {
			this.reduce(envelope, observer);
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
		this.changed(channel, observer);
	}

	private changed(uri: string, observer: Observer): void {
		if (uri === rootChannel) {
			this.root = observer.state as RootState;
		}
		for (const listener of [...observer.listeners]) {
			listener({ state: observer.state!, connection: this.generation });
		}
	}

	private async open(): Promise<AhpClient> {
		await this.ready();
		// The connection can close between ready() settling and this continuation.
		if (!this.client) {
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
			this.actions.set(seq, { seq, resolve, reject, timer });
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
