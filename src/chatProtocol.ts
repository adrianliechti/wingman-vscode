// Messages between the extension and the chat webview. The webview holds the
// AHP connection; the extension supplies what only the editor knows.

/** A saved session, as the history picker shows it. */
export type SessionItem = {
	uri: string;
	title: string;
	modifiedAt: string;
	running: boolean;
	waiting: boolean;
	current: boolean;
};

type Position = { line: number, character: number };
export type FileAttachment = {
	uri: string;
	label: string;
	selection?: { range: { start: Position, end: Position } };
	/** Base64-encoded UTF-8 from the editor, including unsaved text. */
	snapshot?: string;
};
export type FileSearch = { files: FileAttachment[], editor?: FileAttachment };

export type ToWebview =
	/** `directory` is the workspace folder's file URI; `notice` says why there is none. */
	| { type: 'init', address: string, canStartHost: boolean, directory?: string, notice?: string }
	| { type: 'newChat' }
	| { type: 'listSessions', requestId: number }
	| { type: 'renameSession', uri: string, title: string }
	| ({ type: 'fileContext', requestId: number, error?: string } & FileSearch)
	| { type: 'openSession', uri: string };

export type FromWebview =
	| { type: 'ready' }
	| { type: 'startHost' }
	| { type: 'findFiles', requestId: number, query: string }
	| { type: 'attachEditor', requestId: number, uri: string }
	| { type: 'sessions', requestId: number, items: SessionItem[], error?: string }
	/** The open session's title, shown beside the view's name. */
	| { type: 'title', title: string, session?: { uri: string, title: string } }
	| { type: 'openFile', uri: string, line?: number }
	| { type: 'openLink', url: string };
