import type * as Protocol from '@microsoft/agent-host-protocol';

// The SDK declares const enums, which a bundler cannot import as values. These
// are the few discriminants this client writes, typed against the SDK.
export const ActionType = {
	ChatPendingMessageSet: 'chat/pendingMessageSet' as Protocol.ActionType.ChatPendingMessageSet,
	ChatPendingMessageRemoved: 'chat/pendingMessageRemoved' as Protocol.ActionType.ChatPendingMessageRemoved,
	ChatTurnCancelled: 'chat/turnCancelled' as Protocol.ActionType.ChatTurnCancelled,
	ChatToolCallConfirmed: 'chat/toolCallConfirmed' as Protocol.ActionType.ChatToolCallConfirmed,
	ChatInputCompleted: 'chat/inputCompleted' as Protocol.ActionType.ChatInputCompleted,
	ChatConfigChanged: 'chat/configChanged' as Protocol.ActionType.ChatConfigChanged,
};
export const SessionStatus = {
	InProgress: 8 as Protocol.SessionStatus.InProgress,
};
export const MessageKind = {
	User: 'user' as Protocol.MessageKind.User,
};
export const PendingMessageKind = {
	Queued: 'queued' as Protocol.PendingMessageKind.Queued,
};
export const ToolCallConfirmationReason = {
	UserAction: 'user-action' as Protocol.ToolCallConfirmationReason.UserAction,
};
export const ToolCallCancellationReason = {
	Denied: 'denied' as Protocol.ToolCallCancellationReason.Denied,
};
export const ChatInputResponseKind = {
	Accept: 'accept' as Protocol.ChatInputResponseKind.Accept,
	Decline: 'decline' as Protocol.ChatInputResponseKind.Decline,
};
export const ChatInputAnswerState = {
	Submitted: 'submitted' as Protocol.ChatInputAnswerState.Submitted,
};
export const ChatInputAnswerValueKind = {
	Boolean: 'boolean' as Protocol.ChatInputAnswerValueKind.Boolean,
	Number: 'number' as Protocol.ChatInputAnswerValueKind.Number,
	Text: 'text' as Protocol.ChatInputAnswerValueKind.Text,
	Selected: 'selected' as Protocol.ChatInputAnswerValueKind.Selected,
	SelectedMany: 'selected-many' as Protocol.ChatInputAnswerValueKind.SelectedMany,
};

/** The agent this panel talks to: Wingman's own, not the wrapped CLIs. */
export const provider = 'wingman';
export const rootChannel = 'ahp-root://';
