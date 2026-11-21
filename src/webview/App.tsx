import type {
	ActiveTurn,
	ChatInputQuestion,
	ChatInputRequest,
	ResponsePart,
	ToolCallPendingConfirmationState,
	ToolCallState,
	ToolResultContent,
	Turn,
} from '@microsoft/agent-host-protocol';
import {
	memo,
	useCallback,
	useEffect,
	useLayoutEffect,
	useRef,
	useState,
	useSyncExternalStore,
	type FormEvent,
	type KeyboardEvent,
	type ReactNode,
} from 'react';

import { display, settings, type Chat, type Option, type View } from './chat';
import { CheckIcon, ChevronIcon, CrossIcon, SendIcon, Spinner, StopIcon } from './icons';
import { Link, LinkContext, Markdown } from './Markdown';

/** What the editor does for the panel. */
export type Host = {
	startHost(): void;
	openFile(uri: string, line?: number): void;
	openLink(url: string): void;
	setTitle(title: string): void;
};

export function App({ chat, host, focus, icon }: { chat: Chat, host: Host, focus: number, icon?: string }) {
	const view = useSyncExternalStore(chat.subscribe, chat.getView);
	const scroller = useRef<HTMLDivElement>(null);
	// Follow new output only while the user is reading the end of the transcript.
	const pinned = useRef(true);
	const follow = () => {
		const element = scroller.current;
		if (element) {
			pinned.current = element.scrollHeight - element.scrollTop - element.clientHeight < 48;
		}
	};
	useLayoutEffect(() => {
		const element = scroller.current;
		if (element && pinned.current) {
			element.scrollTop = element.scrollHeight;
		}
	}, [view.chat, view.session, view.opening]);

	const title = view.chat?.title || view.session?.title || '';
	useEffect(() => host.setTitle(title), [host, title]);

	const directory = view.directory;
	const open = useCallback((href: string) => {
		if (/^https?:\/\//i.test(href)) {
			host.openLink(href);
			return;
		}
		// Anything else is a file: a URI, or a path in the folder, with an optional line.
		const [, path, suffix] = /^(.*?)(?::(\d+)(?::\d+)?)?$/.exec(href) ?? [];
		try {
			const url = new URL(path ?? href, directory ? directory.replace(/\/?$/, '/') : undefined);
			const line = suffix ?? /^#L(\d+)/.exec(url.hash)?.[1];
			url.hash = '';
			if (url.protocol === 'file:') {
				host.openFile(url.href, line ? Number(line) : undefined);
			}
		} catch {
			// not a location
		}
	}, [host, directory]);

	return (
		<LinkContext value={open}>
			<div className="app">
				<div className="transcript" ref={scroller} onScroll={follow}>
					{view.chat ? <Transcript view={view} chat={chat} /> : <Welcome view={view} host={host} chat={chat} icon={icon} />}
				</div>
				<Composer key={view.composerKey} view={view} chat={chat} host={host} focus={focus} onSend={() => { pinned.current = true; }} />
			</div>
		</LinkContext>
	);
}

function Welcome({ view, host, chat, icon }: { view: View, host: Host, chat: Chat, icon?: string }) {
	let message: ReactNode;
	if (view.notice) {
		message = <p>{view.notice}</p>;
	} else if (!view.connected) {
		message = <HostOffline canStart={view.canStartHost} host={host} chat={chat} />;
	} else if (!view.agent) {
		message = <p>This agent host does not offer the Wingman agent.</p>;
	} else if (view.opening) {
		message = <p><Spinner /> Opening session…</p>;
	} else {
		message = <p>Ask about this project, or describe a change to make.</p>;
	}
	return (
		<div className="welcome">
			{icon && <img className="welcome-icon" src={icon} width={72} height={72} alt="" />}
			<h1>Wingman</h1>
			{message}
		</div>
	);
}

function HostOffline({ canStart, host, chat }: { canStart: boolean, host: Host, chat: Chat }) {
	return (
		<div className="delayed" role="status">
			<p>Waiting for the Wingman agent host on this machine.</p>
			{canStart ? <>
				<button type="button" className="button" onClick={() => { host.startHost(); chat.reconnect(); }}>Start Agent Host</button>
				<p className="hint">If it does not start, see Output → Wingman AI.</p>
			</> : <p className="hint">Run <code>wingman host</code> in a terminal.</p>}
		</div>
	);
}

function Transcript({ view, chat }: { view: View, chat: Chat }) {
	const state = view.chat!;
	const active = state.activeTurn;
	// A question raised while no turn runs belongs to the session only.
	const asked = new Set<string>();
	for (const part of active?.responseParts ?? []) {
		if (part.kind === 'inputRequest') {
			asked.add(part.request.id);
		}
	}
	const questions = (view.session?.inputNeeded ?? []).flatMap(need =>
		need.kind === 'chatInput' && need.chat === state.resource && !asked.has(need.request.id) ? [need.request] : []);
	const waiting = questions.length > 0 || (active?.responseParts ?? []).some(part =>
		part.kind === 'toolCall' ? part.toolCall.status === 'pending-confirmation' : part.kind === 'inputRequest' && !part.response);
	// A tool call that still runs shows its own progress.
	const last = active?.responseParts.at(-1);
	const busy = last?.kind === 'toolCall' && last.toolCall.status !== 'completed' && last.toolCall.status !== 'cancelled';
	return (
		<>
			{state.turns.map(turn => <TurnView key={turn.id} turn={turn} chat={chat} />)}
			{active && <TurnView key={active.id} turn={active} chat={chat} />}
			{questions.map(request => <Question key={request.id} request={request} chat={chat} />)}
			{active && !waiting && !busy && <p className="working"><Spinner /> {state.activity || 'Working'}</p>}
			{(state.queuedMessages ?? []).map(queued => (
				<div key={queued.id} className="user queued" title="Sent when the running turn ends">{queued.message.text}</div>
			))}
		</>
	);
}

// The reducers keep finished turns and untouched parts identical, so only
// what a token changed renders again.
const TurnView = memo(function TurnView({ turn, chat }: { turn: Turn | ActiveTurn, chat: Chat }) {
	const state = 'state' in turn ? turn.state : undefined;
	return (
		<section className="turn">
			{/* Turns the host starts itself, such as a background task's result, have no user message. */}
			{turn.message.origin.kind === 'user' && <div className="user">{turn.message.text}</div>}
			{turn.responseParts.map((part, index) => <PartView key={partKey(part, index)} part={part} chat={chat} />)}
			{state === 'cancelled' && <p className="note">Stopped</p>}
			{state === 'error' && !turn.responseParts.some(part => part.kind === 'error') && <div className="error" role="alert">The turn failed.</div>}
		</section>
	);
});

function partKey(part: ResponsePart, index: number): string {
	return part.kind === 'markdown' || part.kind === 'reasoning' ? part.id : part.kind === 'toolCall' ? part.toolCall.toolCallId : String(index);
}

const PartView = memo(function PartView({ part, chat }: { part: ResponsePart, chat: Chat }) {
	switch (part.kind) {
		case 'markdown':
			return <Markdown text={part.content} />;
		case 'reasoning':
			return part.content.trim() ? (
				<details className="fold reasoning">
					<summary><ChevronIcon /> Thinking</summary>
					<div className="fold-body"><Markdown text={part.content} /></div>
				</details>
			) : null;
		case 'toolCall':
			return <ToolCall tool={part.toolCall} chat={chat} />;
		case 'systemNotification':
			return <div className="note"><Markdown text={display(part.content)} /></div>;
		case 'inputRequest':
			return part.response
				? <p className="note">{part.response === 'accept' ? 'Answered' : 'Skipped'}{part.request.message ? `: ${part.request.message}` : ''}</p>
				: <Question request={part.request} chat={chat} />;
		case 'error':
			return <div className="error" role="alert">{part.error.message}</div>;
		default:
			return null;
	}
});

/** JSON arguments read better indented; anything else is shown as sent. */
function pretty(input: string): string {
	try {
		return JSON.stringify(JSON.parse(input), undefined, 2);
	} catch {
		return input;
	}
}

function ToolCall({ tool, chat }: { tool: ToolCallState, chat: Chat }) {
	if (tool.status === 'pending-confirmation') {
		return <Approval tool={tool} chat={chat} />;
	}
	// The approval itself is listed as a call; the tool it approved follows.
	if (tool.toolCallId.startsWith('approval:')) {
		return null;
	}
	const failed = tool.status === 'cancelled' || tool.status === 'completed' && !tool.success;
	const done = tool.status === 'completed' || tool.status === 'cancelled';
	const title = (tool.status === 'completed' && display(tool.pastTenseMessage)) || display(tool.invocationMessage) || tool.displayName || tool.toolName;
	const input = tool.status === 'streaming' ? tool.partialInput ?? '' : typeof tool.toolInput === 'string' ? tool.toolInput : '';
	const content = tool.status === 'completed' || tool.status === 'running' ? tool.content ?? [] : [];
	const output = tool.status === 'cancelled'
		? display(tool.reasonMessage)
		: content.flatMap(item => item.type === 'text' && item.text ? [item.text] : []).join('\n') || (tool.status === 'completed' ? tool.error?.message ?? '' : '');
	const files = content.flatMap(fileOf);
	// What the call is about: the agent's own words, or else the file it touched.
	const subject = tool.intention && tool.intention !== title ? tool.intention : files.length ? fileName(files[0].uri, 1) : '';
	return (
		<details className="fold tool" data-failed={failed || undefined}>
			<summary>
				{done ? failed ? <CrossIcon /> : <CheckIcon /> : <Spinner />}
				<span className="tool-title"><Markdown text={title} />{subject && <span className="tool-subject"> {subject}</span>}</span>
			</summary>
			<div className="fold-body">
				{input && <pre className="plain">{pretty(input)}</pre>}
				{output && <pre className="plain">{output}</pre>}
				{files.length > 0 && <FileLinks files={files} />}
				{!input && !output && !files.length && <p className="hint">{done ? 'No output.' : 'Running…'}</p>}
			</div>
		</details>
	);
}

type FileRef = { uri: string, stats?: string };

function fileOf(item: ToolResultContent): FileRef[] {
	if (item.type === 'resource') {
		return [{ uri: item.uri }];
	}
	if (item.type === 'fileEdit') {
		const uri = item.after?.uri ?? item.before?.uri;
		const stats = [item.diff?.added ? `+${item.diff.added}` : '', item.diff?.removed ? `−${item.diff.removed}` : ''].filter(Boolean).join(' ');
		return uri ? [{ uri, ...(stats ? { stats } : {}) }] : [];
	}
	return [];
}

/** The last segments of a file URI's path. */
function fileName(uri: string, segments: number): string {
	try {
		return decodeURIComponent(new URL(uri).pathname).split('/').slice(-segments).join('/');
	} catch {
		return uri;
	}
}

function FileLinks({ files }: { files: FileRef[] }) {
	return (
		<ul className="files">
			{files.map((file, index) => (
				<li key={index}><Link href={file.uri}>{fileName(file.uri, 2)}</Link>{file.stats && <span className="hint"> {file.stats}</span>}</li>
			))}
		</ul>
	);
}

function Approval({ tool, chat }: { tool: ToolCallPendingConfirmationState, chat: Chat }) {
	const [busy, setBusy] = useState(false);
	const title = display(tool.confirmationTitle) || tool.displayName || tool.toolName;
	const message = tool.invocationMessage;
	const input = typeof tool.toolInput === 'string' ? tool.toolInput : '';
	const options = tool.options ?? [];
	const answer = (approve: boolean, option?: string) => {
		setBusy(true);
		void chat.confirm(tool.toolCallId, approve, option).finally(() => setBusy(false));
	};
	return (
		<div className="card" role="group" aria-label="Approval needed">
			<div className="card-title"><Markdown text={title} /></div>
			{/* Plain text is what will run, such as a command line, and keeps its line breaks. */}
			{typeof message === 'string'
				? message && message !== title && <pre className="plain">{message}</pre>
				: <Markdown text={display(message)} />}
			{input && <pre className="plain">{pretty(input)}</pre>}
			<div className="card-actions">
				{options.length
					? options.map(option => (
						<button key={option.id} type="button" disabled={busy} className={option.kind === 'approve' ? 'button' : 'button secondary'} onClick={() => answer(option.kind === 'approve', option.id)}>
							{option.label}
						</button>
					))
					: <>
						<button type="button" disabled={busy} className="button" onClick={() => answer(true)}>Allow</button>
						<button type="button" disabled={busy} className="button secondary" onClick={() => answer(false)}>Deny</button>
					</>}
			</div>
		</div>
	);
}

function initial(question: ChatInputQuestion): unknown {
	switch (question.kind) {
		case 'boolean':
			return question.defaultValue ?? false;
		case 'single-select':
			return question.options.find(option => option.recommended)?.id ?? '';
		case 'multi-select':
			return question.options.filter(option => option.recommended).map(option => option.id);
		default:
			return question.defaultValue ?? '';
	}
}

function Question({ request, chat }: { request: ChatInputRequest, chat: Chat }) {
	const questions = request.questions ?? [];
	const [values, setValues] = useState<Record<string, unknown>>(() => Object.fromEntries(questions.map(question => [question.id, initial(question)])));
	const [busy, setBusy] = useState(false);
	const send = (content?: Record<string, unknown>) => {
		setBusy(true);
		void chat.answer(request, content).finally(() => setBusy(false));
	};
	const submit = (event: FormEvent) => {
		event.preventDefault();
		// An empty field is no answer.
		send(Object.fromEntries(Object.entries(values).filter(([, value]) => value !== '')));
	};
	return (
		<form className="card" onSubmit={submit}>
			{/* A single question usually repeats the request's message. */}
			{request.message && !questions.some(question => question.message === request.message) && <div className="card-title"><Markdown text={request.message} /></div>}
			{request.url && <p><Link href={request.url}>Open link</Link></p>}
			{questions.map(question => (
				<Field key={question.id} question={question} value={values[question.id]} onChange={value => setValues(current => ({ ...current, [question.id]: value }))} />
			))}
			<div className="card-actions">
				<button type="submit" disabled={busy} className="button">Submit</button>
				<button type="button" disabled={busy} className="button secondary" onClick={() => send()}>Skip</button>
			</div>
		</form>
	);
}

function Field({ question, value, onChange }: { question: ChatInputQuestion, value: unknown, onChange: (value: unknown) => void }) {
	const label = <span className="field-label">{question.title && question.title !== question.message && <strong>{question.title} </strong>}{question.message}</span>;
	if (question.kind === 'boolean') {
		return <label className="field choice"><input type="checkbox" checked={value === true} onChange={event => onChange(event.target.checked)} />{label}</label>;
	}
	if (question.kind === 'single-select' || question.kind === 'multi-select') {
		const many = question.kind === 'multi-select';
		const chosen = many ? value as string[] : [value as string];
		const listed = question.options.some(option => option.id === value);
		return (
			<fieldset className="field">
				<legend>{label}</legend>
				{question.options.map(option => (
					<label key={option.id} className="choice" title={option.description}>
						<input
							type={many ? 'checkbox' : 'radio'}
							name={question.id}
							checked={chosen.includes(option.id)}
							onChange={event => onChange(many
								? event.target.checked ? [...chosen, option.id] : chosen.filter(id => id !== option.id)
								: option.id)}
						/>
						<span>{option.label}{option.description && <span className="hint"> — {option.description}</span>}</span>
					</label>
				))}
				{!many && question.allowFreeformInput && (
					<input type="text" className="input" placeholder="Other…" value={listed ? '' : String(value ?? '')} onChange={event => onChange(event.target.value)} />
				)}
			</fieldset>
		);
	}
	const numeric = question.kind === 'number' || question.kind === 'integer';
	return (
		<label className="field">
			{label}
			<input
				type={numeric ? 'number' : 'text'}
				className="input"
				required={question.required}
				step={numeric ? question.kind === 'integer' ? 1 : 'any' : undefined}
				min={numeric ? question.min : undefined}
				max={numeric ? question.max : undefined}
				minLength={question.kind === 'text' ? question.min : undefined}
				maxLength={question.kind === 'text' ? question.max : undefined}
				value={String(value ?? '')}
				onChange={event => onChange(event.target.value)}
			/>
		</label>
	);
}

function Picker({ label, value, options, disabled, onChange }: { label: string, value: string, options: Option[], disabled: boolean, onChange: (value: string) => void }) {
	if (!options.length) {
		return null;
	}
	return (
		<span className="picker">
			<select aria-label={label} title={label} value={value} disabled={disabled} onChange={event => onChange(event.target.value)}>
				{/* The host may run a value it does not list, such as its default. */}
				{!options.some(option => option.id === value) && <option value={value}>{value || label}</option>}
				{options.map(option => <option key={option.id} value={option.id}>{option.label}</option>)}
			</select>
		</span>
	);
}

function Composer({ view, chat, host, focus, onSend }: { view: View, chat: Chat, host: Host, focus: number, onSend: () => void }) {
	const [text, setText] = useState('');
	const input = useRef<HTMLTextAreaElement>(null);
	const lastFocus = useRef(0);
	const running = !!view.chat?.activeTurn;
	const ready = view.connected && !!view.directory && !!view.agent && !view.opening;
	const current = settings(view.config, view.agent);

	useLayoutEffect(() => {
		const element = input.current;
		if (element) {
			element.style.height = 'auto';
			element.style.height = `${Math.min(element.scrollHeight, 240)}px`;
		}
	}, [text]);
	useEffect(() => {
		if (ready && focus > lastFocus.current) {
			lastFocus.current = focus;
			input.current?.focus();
		}
	}, [focus, ready]);

	const submit = async () => {
		const message = text.trim();
		if (!message || !ready || view.sending) {
			return;
		}
		setText('');
		onSend();
		// A message that was not delivered returns to the input.
		if (!await chat.send(message)) {
			setText(typed => typed || message);
		}
	};
	const keyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
		if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) {
			event.preventDefault();
			void submit();
		}
	};

	return (
		<footer className="composer">
			{view.chat && !view.connected && <HostOffline canStart={view.canStartHost} host={host} chat={chat} />}
			{view.error && (
				<div className="error" role="alert">
					<span>{view.error}</span>
					<button type="button" className="icon-button" title="Dismiss" aria-label="Dismiss" onClick={() => chat.dismiss()}><CrossIcon /></button>
				</div>
			)}
			<div className="input-box">
				<textarea
					ref={input}
					rows={1}
					value={text}
					disabled={!ready}
					readOnly={view.sending}
					placeholder={running ? 'Queue a follow-up…' : 'Ask Wingman…'}
					aria-label="Message"
					onChange={event => setText(event.target.value)}
					onKeyDown={keyDown}
				/>
				<div className="input-toolbar">
					<Picker label="Model" value={current.model} options={current.models} disabled={!ready || view.sending} onChange={value => { void chat.configure('model', value); }} />
					<Picker label="Mode" value={current.mode} options={current.modes} disabled={!ready || view.sending} onChange={value => { void chat.configure('mode', value); }} />
					<Picker label="Effort" value={current.effort} options={current.efforts} disabled={!ready || view.sending} onChange={value => { void chat.configure('effort', value); }} />
					<span className="spacer" />
					{running
						? <button type="button" className="button round" title="Stop" aria-label="Stop" disabled={!ready} onClick={() => { void chat.cancel(); }}><StopIcon /></button>
						: <button type="button" className="button round" title="Send" aria-label="Send" disabled={!ready || !text.trim() || view.sending} onClick={() => { void submit(); }}><SendIcon /></button>}
				</div>
			</div>
		</footer>
	);
}
