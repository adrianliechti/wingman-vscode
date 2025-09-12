import * as vscode from 'vscode';
import { ChatModelProvider } from "./provider";


// This method is called when your extension is activated
// Your extension is activated the very first time the command is executed
export function activate(context: vscode.ExtensionContext) {
	const provider = new ChatModelProvider(context.secrets);
	vscode.lm.registerLanguageModelChatProvider("wingman", provider);
	
	console.log('Wingman is now active!');
}

export function deactivate() { }
