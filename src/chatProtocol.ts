// Messages between the extension and the chat webview. The webview holds the
// AHP connection; the extension supplies what only the editor knows.

/** A saved session, as the history picker shows it. */
export type SessionItem = {
	uri: string;
	title: string;
	modifiedAt: string;
	running: boolean;
	current: boolean;
};

export type ToWebview =
	/** `directory` is the workspace folder's file URI; `notice` says why there is none. */
	| { type: 'init', address: string, directory?: string, notice?: string }
	| { type: 'newChat' }
	| { type: 'listSessions' }
	| { type: 'openSession', uri: string };

export type FromWebview =
	| { type: 'ready' }
	| { type: 'startHost' }
	| { type: 'sessions', items: SessionItem[], error?: string }
	/** The open session's title, shown beside the view's name. */
	| { type: 'title', title: string }
	| { type: 'openFile', uri: string, line?: number }
	| { type: 'openLink', url: string };
