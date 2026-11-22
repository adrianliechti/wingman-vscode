declare module '*.css';

/** Provided by VS Code inside a webview; it may be called once. */
declare function acquireVsCodeApi(): {
	postMessage(message: unknown): void;
	getState(): unknown;
	setState(state: unknown): void;
};
