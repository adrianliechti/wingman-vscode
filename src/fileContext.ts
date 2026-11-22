import { realpath } from 'node:fs/promises';
import { isAbsolute, relative, sep } from 'node:path';
import * as vscode from 'vscode';

import type { FileAttachment } from './chatProtocol';

const maxSnapshotBytes = 128 * 1024;

function fileLabel(folder: string, file: string): string | undefined {
	const path = relative(folder, file);
	return path && !isAbsolute(path) && path !== '..' && !path.startsWith(`..${sep}`)
		? path.split(sep).join('/')
		: undefined;
}

function searchGlob(query: string): string {
	// Each typed path segment can match part of its directory or file name.
	const segments = query.split('/').filter(Boolean).map(segment => {
		const escaped = segment.replace(/[a-z\[\]{}?*]/gi, char => /[a-z]/i.test(char)
			? `[${char.toLowerCase()}${char.toUpperCase()}]`
			: `[${char}]`);
		return `*${escaped}*`;
	});
	return `**/${segments.join('/') || '*'}${segments.length && query.endsWith('/') ? '/**' : ''}`;
}

export async function findWorkspaceFiles(folder: vscode.WorkspaceFolder, query: string, token?: vscode.CancellationToken): Promise<FileAttachment[]> {
	const pattern = new vscode.RelativePattern(folder, searchGlob(query.slice(0, 160)));
	const candidates = await vscode.workspace.findFiles(pattern, undefined, 48, token);
	return candidates.flatMap(uri => {
		const label = fileLabel(folder.uri.fsPath, uri.fsPath);
		return uri.scheme === 'file' && label ? [{ uri: uri.toString(), label }] : [];
	}).sort((a, b) => a.label.localeCompare(b.label)).slice(0, 12);
}

export function editorReference(folder: vscode.WorkspaceFolder, editor: vscode.TextEditor | undefined): FileAttachment | undefined {
	const uri = editor?.document.uri;
	const label = uri?.scheme === 'file' ? fileLabel(folder.uri.fsPath, uri.fsPath) : undefined;
	if (!editor || !uri || !label) {
		return;
	}
	const { selection } = editor;
	const attachment: FileAttachment = { uri: uri.toString(), label };
	if (!selection.isEmpty) {
		const { start, end } = selection;
		attachment.selection = { range: {
			start: { line: start.line, character: start.character },
			end: { line: end.line, character: end.character },
		} };
	}
	return attachment;
}

export async function editorAttachment(folder: vscode.WorkspaceFolder, editor: vscode.TextEditor | undefined, expectedUri: string): Promise<FileAttachment> {
	const attachment = editorReference(folder, editor);
	if (!editor || !attachment || attachment.uri !== expectedUri) {
		throw new Error('The active editor changed. Open the file picker again.');
	}
	const { document, selection } = editor;
	if (!selection.isEmpty || document.isDirty) {
		const text = document.getText(selection.isEmpty ? undefined : selection);
		if (Buffer.byteLength(text) > maxSnapshotBytes) {
			throw new Error('This editor attachment is larger than 128 KB. Select a smaller range or save the file and attach it from file search.');
		}
		const [root, target] = await Promise.all([realpath(folder.uri.fsPath), realpath(document.uri.fsPath)]);
		if (!fileLabel(root, target)) {
			throw new Error('The editor file is outside the Wingman workspace.');
		}
		attachment.snapshot = Buffer.from(text, 'utf8').toString('base64');
	}
	return attachment;
}
