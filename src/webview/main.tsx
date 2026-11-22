import { createRoot } from 'react-dom/client';

import type { FileSearch, FromWebview, ToWebview } from '../chatProtocol';
import { App, type Host } from './App';
import { Chat, text } from './chat';
import './styles.css';

const vscode = acquireVsCodeApi();
const post = (message: FromWebview) => vscode.postMessage(message);
const chat = new Chat(vscode);
type FileReply = Extract<ToWebview, { type: 'fileContext' }>;
const fileRequests = new Map<number, (reply: FileReply) => void>();
let nextFileRequest = 0;

function requestFiles(request: { type: 'findFiles', query: string } | { type: 'attachEditor', uri: string }, signal: AbortSignal): Promise<FileSearch> {
	return new Promise((resolve, reject) => {
		const requestId = ++nextFileRequest;
		const finish = (reply: FileReply) => {
			window.clearTimeout(timeout);
			signal.removeEventListener('abort', abort);
			fileRequests.delete(requestId);
			if (reply.error) {
				reject(new Error(reply.error));
			} else {
				resolve({ files: reply.files, editor: reply.editor });
			}
		};
		const fail = (error: string) => finish({ type: 'fileContext', requestId, files: [], error });
		const abort = () => fail('File request cancelled.');
		const timeout = window.setTimeout(() => fail('VS Code did not respond to the file request.'), 10_000);
		if (signal.aborted) {
			abort();
			return;
		}
		signal.addEventListener('abort', abort, { once: true });
		fileRequests.set(requestId, finish);
		post({ ...request, requestId });
	});
}

const host: Host = {
	startHost: () => post({ type: 'startHost' }),
	openFile: (uri, line) => post({ type: 'openFile', uri, line }),
	openLink: url => post({ type: 'openLink', url }),
	setTitle: (title, session) => post({ type: 'title', title, session }),
	findFiles: (query, signal) => requestFiles({ type: 'findFiles', query }, signal),
	attachEditor: async (uri, signal) => (await requestFiles({ type: 'attachEditor', uri }, signal)).files[0],
};

const container = document.getElementById('root')!;
const root = createRoot(container);
// Counts requests to put the cursor in the message box.
let focus = 0;
const render = () => root.render(<App chat={chat} host={host} focus={focus} icon={container.dataset.icon} />);

window.addEventListener('message', (event: MessageEvent<ToWebview>) => {
	const message = event.data;
	switch (message.type) {
		case 'init':
			chat.init(message);
			break;
		case 'newChat':
			chat.newChat();
			focus++;
			render();
			break;
		case 'openSession':
			chat.openSession(message.uri);
			focus++;
			render();
			break;
		case 'renameSession':
			void chat.renameSession(message.uri, message.title);
			break;
		case 'fileContext':
			fileRequests.get(message.requestId)?.(message);
			break;
		case 'listSessions':
			chat.listSessions().then(
				items => post({ type: 'sessions', requestId: message.requestId, items }),
				error => post({ type: 'sessions', requestId: message.requestId, items: [], error: text(error) }),
			);
			break;
	}
});

render();
post({ type: 'ready' });
