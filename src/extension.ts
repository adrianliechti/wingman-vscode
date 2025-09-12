import * as vscode from 'vscode';
import { ChatModelProvider } from "./provider";


// This method is called when your extension is activated
// Your extension is activated the very first time the command is executed
export function activate(context: vscode.ExtensionContext) {
	const provider = new ChatModelProvider(context.secrets);
	vscode.lm.registerLanguageModelChatProvider("wingman", provider);
	
	context.subscriptions.push(
		vscode.commands.registerCommand("wingman.manage", async () => {
			const existingBaseUrl = await context.secrets.get("wingman.baseUrl");
			const existingApiKey = await context.secrets.get("wingman.apiKey");

			const baseUrl = await vscode.window.showInputBox({
				title: "Wingman Base Url",
				prompt: existingBaseUrl ? "Update Base Url" : "Enter Base Url",
				ignoreFocusOut: true,
				password: false,
				value: existingBaseUrl ?? "",
			});

			if (baseUrl === undefined) {
				return; // user canceled
			}

			const apiKey = await vscode.window.showInputBox({
				title: "Wingman API Key",
				prompt: existingApiKey ? "Update API Key" : "Enter API Key",
				ignoreFocusOut: true,
				password: true,
				value: existingApiKey ?? "",
			});

			if (apiKey === undefined) {
				return; // user canceled
			}

			if (!apiKey.trim()) {
				await context.secrets.delete("wingman.apiKey");
				vscode.window.showInformationMessage("API Key cleared.");
				return;
			}

			await context.secrets.store("wingman.apiKey", apiKey.trim());
			vscode.window.showInformationMessage("API Key saved.");
		})
	);
}

export function deactivate() { }
