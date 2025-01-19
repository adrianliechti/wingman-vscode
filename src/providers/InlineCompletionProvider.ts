import * as vscode from "vscode";
import OpenAI from "openai";

export class InlineCompletionProvider implements vscode.InlineCompletionItemProvider {
  private disposables: vscode.Disposable[] = [];

  private timer: NodeJS.Timeout | undefined;
  private cancelTokenSource: vscode.CancellationTokenSource | undefined;

  private model: string
  private client: OpenAI
  
  private lastCompletion = ''
  private delayCompletion = 750;
  private allowCompletion = true;

  constructor() {
    const config = vscode.workspace.getConfiguration('adrianliechti.wingman-vscode');

    this.model = config.get<string>('model') ?? ''

    this.client = new OpenAI({
      apiKey: config.get<string>('apiKey') ?? '',
      baseURL: config.get<string>('baseUrl') ?? '',
    });

    console.log(this.model)
    console.log(this.client.baseURL)
    console.log(this.client.apiKey)

    this.disposables.push(
      vscode.workspace.onDidChangeTextDocument((e: vscode.TextDocumentChangeEvent) => {
        if (e.reason === vscode.TextDocumentChangeReason.Undo || e.reason === vscode.TextDocumentChangeReason.Redo) {
          return;
        }

        for (const change of e.contentChanges) {
          if (this.lastCompletion && change.text === this.lastCompletion) {
            continue;
          }

          if (change.text.length <= 1 || (change.rangeLength <= 1 && change.text.length <= 3)) {
            this.allowCompletion = true;
          }
        }
      })
    );
  }

  dispose() {
    this.disposables.forEach((d) => d.dispose());
    this.disposables = [];
  }

  provideInlineCompletionItems(document: vscode.TextDocument, position: vscode.Position, context: vscode.InlineCompletionContext, token: vscode.CancellationToken): vscode.ProviderResult<vscode.InlineCompletionItem[]> {
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = undefined;
    }

    if (this.cancelTokenSource) {
      this.cancelTokenSource.cancel();
      this.cancelTokenSource.dispose();
    }

    if (token.isCancellationRequested) {
      return [];
    }

    if (!this.allowCompletion) {
      return [];
    }

    const editor = vscode.window.activeTextEditor;

    if (editor && editor.selections.length > 1) {
      return [];
    }

    this.cancelTokenSource = new vscode.CancellationTokenSource();
    const localToken = this.cancelTokenSource.token;

    return new Promise((resolve, reject) => {
      this.timer = setTimeout(async () => {
        if (localToken.isCancellationRequested) {
          return reject('Cancelled');
        }

        try {
          const input = {
            name: document.fileName,

            language: document.languageId,

            content: document.getText(),
            position: document.offsetAt(position),

            prefix: textBefore(document, position),
            suffix: textAfter(document, position),
          };

          const result = await handleCompletionMessage(this.client, this.model, input);

          if (result?.length > 0) {
            this.lastCompletion = result;
            this.allowCompletion = false;
          }
          
          const completions = [
            {
              insertText: result,
              range: new vscode.Range(position, position)
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
      }, this.delayCompletion);
    });
  }
}

type CompletionContext = {
  name: string;
  language: string;

  content: string;
  position: number;

  prefix: string;
  suffix: string;
};

async function handleCompletionMessage(client: OpenAI, model: string, context: CompletionContext): Promise<string> {
  const system = "You are an expert in software development. Your Task is inline code completion in a code editor. Return the code snippet as JSON."
  const content = "```" + context.language + "\n" + context.prefix + "`[SNIPPET]`" + context.suffix + "\n```"

  const completion = await client.chat.completions.create({
    model: model,

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