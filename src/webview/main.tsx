import { createRoot } from 'react-dom/client';

import type { FromWebview, ToWebview } from '../chatProtocol';
import { App, type Host } from './App';
import { Chat, text } from './chat';
import './styles.css';

const vscode = acquireVsCodeApi();
const post = (message: FromWebview) => vscode.postMessage(message);
const chat = new Chat(vscode);
const host: Host = {
	startHost: () => post({ type: 'startHost' }),
	openFile: (uri, line) => post({ type: 'openFile', uri, line }),
	openLink: url => post({ type: 'openLink', url }),
	setTitle: title => post({ type: 'title', title }),
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
