import * as vscode from "vscode";
import OpenAI from "openai";

const client = new OpenAI({
  apiKey: "-",
  baseURL: "http://localhost:8080/v1",
});

type Message = {
  name: string;
  language: string;

  content: string;
  position: number;

  prefix: string;
  suffix: string;
};

let timer: NodeJS.Timeout | undefined;
let cancelTokenSource: vscode.CancellationTokenSource | undefined;

export const inlineCompletionItemProvider: vscode.InlineCompletionItemProvider =
{
  provideInlineCompletionItems(document, position, context, token): vscode.ProviderResult<vscode.InlineCompletionItem[]> {
    if (timer) {
      clearTimeout(timer);
      timer = undefined;
    }

    if (cancelTokenSource) {
      cancelTokenSource.cancel();
      cancelTokenSource.dispose();
    }

    if (token.isCancellationRequested) {
      return null;
    }

    if (document.uri.scheme === "vscode-scm") {
      return null;
    }

    const editor = vscode.window.activeTextEditor;

    if (editor && editor.selections.length > 1) {
      return null;
    }

    cancelTokenSource = new vscode.CancellationTokenSource();

    const localToken = cancelTokenSource.token;

    return new Promise((resolve, reject) => {
      timer = setTimeout(async () => {
        if (localToken.isCancellationRequested) {
          return reject('Cancelled');
        }

        try {
          const message = {
            name: document.fileName,
      
            language: document.languageId,
      
            content: document.getText(),
            position: document.offsetAt(position),
      
            prefix: textBefore(document, position),
            suffix: textAfter(document, position),
          };

          const result = await handleCompletionMessage(message);

          const completions = [
            {
              insertText: result,
            },
          ]

          if (!localToken.isCancellationRequested) {
            resolve(completions);
          } else {
            reject('Cancelled after fetch');
          }
        } catch (err) {
          reject(err);
        }
      }, 2000); // 750ms debounce
    });
  },
};

async function handleCompletionMessage(message: Message): Promise<string> {
  const system = "You are an expert in software development. Your Task is inline code completion in a code editor. Return the code snippet as JSON."
  const content = "```" + message.language + "\n" + message.prefix + "`[SNIPPET]`" + message.suffix + "\n```"

  const completion = await client.chat.completions.create({
    model: 'gpt-4o-mini',

    messages: [
      { role: 'user', content: system + "\n\n" + content },
    ],

    response_format: {
      type: 'json_schema',

      json_schema: {
        name: 'snippet',
        description: 'the code snippet to be completed into the editor',

        schema: {
          type: 'object',

          properties: {
            // description: {
            //   type: 'string',
            //   description: 'textual description of the code snippet',
            // },

            code: {
              type: 'string',
              description: 'the code snippet without any markdown formatting',
            },
          },
        },

        //strict: true,
      },
    }
  });

  if (completion.choices.length === 0) {
    return "";
  }

  const snippet = JSON.parse(completion.choices[0].message.content ?? "{}");

  return snippet?.code ?? "";
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