import type { MessageAttachment } from '@microsoft/agent-host-protocol';
import type { FileAttachment } from '../chatProtocol';
import { MessageAttachmentKind } from './values';

const sourceUri = 'wingman.sourceUri';

export function fileKey(file: FileAttachment): string {
	return file.selection ? JSON.stringify([file.uri, file.selection.range]) : file.uri;
}

export function fileLabel(file: FileAttachment): string {
	const range = file.selection?.range;
	if (!range) {
		return file.label;
	}
	const first = range.start.line + 1;
	const last = Math.max(first, range.end.line + (range.end.character ? 1 : 0));
	return `${file.label}:L${first}${last > first ? `–L${last}` : ''}`;
}

export function fileHref(uri: string, selection?: FileAttachment['selection']): string {
	return selection ? `${uri}#L${selection.range.start.line + 1}` : uri;
}

export function toMessageAttachment(file: FileAttachment): MessageAttachment {
	const { uri, snapshot, selection } = file;
	const display = { label: fileLabel(file), displayKind: selection ? 'selection' : 'document', selection };
	return snapshot === undefined
		? { ...display, type: MessageAttachmentKind.Resource, uri }
		: { ...display, type: MessageAttachmentKind.EmbeddedResource, data: snapshot, contentType: 'text/plain', _meta: { [sourceUri]: uri } };
}

export function attachmentHref(attachment: MessageAttachment): string | undefined {
	const uri = attachment.type === 'resource' ? attachment.uri : attachment._meta?.[sourceUri];
	if (typeof uri === 'string' && uri.startsWith('file:')) {
		const selection = attachment.type === 'resource' || attachment.type === 'embeddedResource' ? attachment.selection : undefined;
		return fileHref(uri, selection);
	}
}
