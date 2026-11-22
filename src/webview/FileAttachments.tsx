import { useEffect, useId, useRef, useState, type KeyboardEvent, type RefObject } from 'react';
import type { FileAttachment, FileSearch } from '../chatProtocol';
import { fileHref, fileKey, fileLabel } from './attachments';
import { CrossIcon } from './icons';
import { Link } from './Markdown';

export type FileHost = {
	findFiles(query: string, signal: AbortSignal): Promise<FileSearch>;
	attachEditor(uri: string, signal: AbortSignal): Promise<FileAttachment | undefined>;
};

type Mention = { query: string, start: number, end: number };
type FileOption = { file: FileAttachment, editor?: boolean };

function mentionAt(input: HTMLTextAreaElement): Mention | undefined {
	const cursor = input.selectionStart;
	if (cursor !== input.selectionEnd) {
		return;
	}
	const match = /(?:^|\s)@([^\s@]*)$/.exec(input.value.slice(0, cursor));
	if (match) {
		const query = match[1];
		const rest = /^[^\s@]*/.exec(input.value.slice(cursor))?.[0] ?? '';
		return { query, start: cursor - query.length - 1, end: cursor + rest.length };
	}
}

export function useFileAttachments(host: FileHost, input: RefObject<HTMLTextAreaElement | null>, enabled: boolean, setText: (value: string) => void) {
	const [files, setFiles] = useState<FileAttachment[]>([]);
	const [mention, setMention] = useState<Mention>();
	const [results, setResults] = useState<{ query: string, options: FileOption[], error?: string }>();
	const [selected, setSelected] = useState(0);
	const [error, setError] = useState<string>();
	const [attaching, setAttaching] = useState(false);
	const editorRequest = useRef<AbortController>(undefined);
	const listId = useId();
	const query = enabled ? mention?.query : undefined;
	const matches = results?.query === query ? results : undefined;

	useEffect(() => {
		if (query === undefined) {
			return;
		}
		const controller = new AbortController();
		const timer = window.setTimeout(() => {
			void host.findFiles(query, controller.signal).then(
				found => {
					if (!controller.signal.aborted) {
						setResults({
							query,
							options: [
								...(found.editor ? [{ file: found.editor, editor: true }] : []),
								...found.files.map(file => ({ file })),
							],
						});
						setSelected(0);
					}
				},
				reason => {
					if (!controller.signal.aborted) {
						setResults({ query, options: [], error: reason instanceof Error ? reason.message : String(reason) });
					}
				},
			);
		}, 125);
		return () => {
			window.clearTimeout(timer);
			controller.abort();
		};
	}, [host, query]);
	useEffect(() => () => editorRequest.current?.abort(), []);
	useEffect(() => {
		if (query !== undefined && matches?.options[selected]) {
			document.getElementById(`${listId}-${selected}`)?.scrollIntoView({ block: 'nearest' });
		}
	}, [query, matches, listId, selected]);

	const close = () => {
		setMention(undefined);
		setResults(undefined);
		setSelected(0);
	};
	const update = (element: HTMLTextAreaElement) => {
		const next = mentionAt(element);
		if (next) {
			setMention(next);
		} else {
			close();
		}
	};
	const focusAt = (element: HTMLTextAreaElement, caret: number) => {
		requestAnimationFrame(() => {
			if (input.current === element) {
				element.focus();
				element.setSelectionRange(caret, caret);
			}
		});
	};
	const open = () => {
		const element = input.current;
		if (!element || !enabled) {
			return;
		}
		const existing = mentionAt(element);
		setError(undefined);
		if (existing) {
			setMention(existing);
			element.focus();
			return;
		}
		const caret = element.selectionEnd;
		const before = element.value.slice(0, caret);
		const after = element.value.slice(caret);
		const prefix = before && !/\s$/.test(before) ? before + ' ' : before;
		const suffix = after && !/^\s/.test(after) ? ' ' + after : after;
		setText(prefix + '@' + suffix);
		setMention({ query: '', start: prefix.length, end: prefix.length + 1 });
		focusAt(element, prefix.length + 1);
	};
	const accept = async (option: FileOption) => {
		const element = input.current;
		if (!element || !mention || editorRequest.current) {
			return;
		}
		const before = element.value.slice(0, mention.start);
		const after = element.value.slice(mention.end);
		close();
		setError(undefined);
		let file: FileAttachment | undefined = option.file;
		if (option.editor) {
			const controller = new AbortController();
			editorRequest.current = controller;
			setAttaching(true);
			try {
				file = await host.attachEditor(file.uri, controller.signal);
			} catch (reason) {
				file = undefined;
				if (!controller.signal.aborted) {
					setError(reason instanceof Error ? reason.message : String(reason));
				}
			} finally {
				editorRequest.current = undefined;
				if (!controller.signal.aborted) {
					setAttaching(false);
				}
			}
			if (controller.signal.aborted) {
				return;
			}
		}
		if (file) {
			const attached = file;
			const prefix = before + '@' + attached.label;
			const space = !after || !/^\s/.test(after) ? ' ' : '';
			setText(prefix + space + after);
			setFiles(current => [...current.filter(item => fileKey(item) !== fileKey(attached)), attached]);
			focusAt(element, prefix.length + (space || after.startsWith(' ') ? 1 : 0));
		}
	};
	const keyDown = (event: KeyboardEvent<HTMLTextAreaElement>): boolean => {
		if (query === undefined || event.nativeEvent.isComposing) {
			return false;
		}
		const count = matches?.options.length ?? 0;
		switch (event.key) {
			case 'Escape':
				close();
				break;
			case 'ArrowDown':
			case 'ArrowUp':
				if (!count) { return false; }
				setSelected(index => (index + (event.key === 'ArrowDown' ? 1 : count - 1)) % count);
				break;
			case 'Enter':
			case 'Tab':
				if (event.shiftKey) { return false; }
				if (matches?.options[selected]) {
					void accept(matches.options[selected]);
				} else if (event.key === 'Tab' || matches) {
					return false;
				}
				break;
			default:
				return false;
		}
		event.preventDefault();
		return true;
	};

	return {
		files,
		attaching,
		error,
		clear: () => { setFiles([]); setError(undefined); close(); },
		remove: (file: FileAttachment) => setFiles(current => current.filter(item => fileKey(item) !== fileKey(file))),
		update,
		close,
		open,
		keyDown,
		activeId: query !== undefined && matches?.options[selected] ? `${listId}-${selected}` : undefined,
		listId: query !== undefined ? listId : undefined,
		suggestions: query !== undefined && (
			<div className="file-suggestions">
				<ul id={listId} role="listbox" aria-label="Workspace files">
					{matches?.options.map((option, index) => {
						const { file, editor } = option;
						const label = editor ? `Current ${file.selection ? 'selection' : 'file'} · ${fileLabel(file)}` : file.label;
						return <li key={editor ? 'current-editor' : file.uri} id={`${listId}-${index}`} role="option" aria-selected={index === selected}
							title={label} onMouseDown={event => event.preventDefault()} onClick={() => { void accept(option); }}>
							{label}
						</li>;
					})}
				</ul>
				{!matches?.options.length && <div className="file-search-status" role="status">{matches?.error ?? (matches ? 'No matching files.' : 'Finding files…')}</div>}
			</div>
		),
	};
}

export function AttachmentChips({ items }: { items: { label: string, href?: string, remove?: () => void, disabled?: boolean }[] }) {
	return items.length > 0 && (
		<ul className="attachments" aria-label="Attachments">
			{items.map((item, index) => (
				<li key={index} className="attachment" title={item.label}>
					{item.href ? <Link href={item.href}>{item.label}</Link> : <span>{item.label}</span>}
					{item.remove && <button type="button" className="icon-button" aria-label={`Remove ${item.label}`} disabled={item.disabled} onClick={item.remove}><CrossIcon /></button>}
				</li>
			))}
		</ul>
	);
}

export function draftChips(files: FileAttachment[], remove: (file: FileAttachment) => void, disabled: boolean) {
	return files.map(file => ({ label: fileLabel(file), href: fileHref(file.uri, file.selection), remove: () => remove(file), disabled }));
}
