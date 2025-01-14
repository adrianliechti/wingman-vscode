import * as vscode from "vscode";

export const inlineCompletionItemProvider: vscode.InlineCompletionItemProvider =
  {
    async provideInlineCompletionItems(document, position, context, token) {
      const message = {
        name: document.fileName,

        language: document.languageId,

        content: document.getText(),
        position: document.offsetAt(position),        

        prefix: textBefore(document, position),
        suffix: textAfter(document, position),
      };

      const result = await handleCompletionMessage(JSON.stringify(message));
      
      return {
        items: [
          {
            insertText: String(result),
          },
        ],
      };
    },
  };

async function handleCompletionMessage(message: string): Promise<string> {
    console.log(message);
    return "hallo du";
}

function textBefore(document: vscode.TextDocument, position: vscode.Position) {
  const start = new vscode.Position(0, 0);
  const rangeBefore = new vscode.Range(start, position);

  return document.getText(rangeBefore);
}

function textAfter(document: vscode.TextDocument, position: vscode.Position) {
  const lastLine = document.lineAt(document.lineCount - 1);
  const endPosition = lastLine.range.end;

  const rangeAfter = new vscode.Range(position, endPosition);

  return document.getText(rangeAfter);
}