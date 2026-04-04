import { mkdirSync, readdirSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs';
import * as http from 'node:http';
import { homedir } from 'node:os';
import { join } from 'node:path';
import * as vscode from 'vscode';

const lockfileDir = join(homedir(), '.wingman', 'bridge');

export class Bridge implements vscode.Disposable {
    private server: http.Server | undefined;
    private lockfilePath: string | undefined;

    constructor(private readonly logger: vscode.LogOutputChannel) { }

    async start(): Promise<number> {
        cleanStaleLockfiles();

        return new Promise((resolve, reject) => {
            const server = http.createServer((req, res) => this.handleRequest(req, res));
            this.server = server;

            server.listen(0, '127.0.0.1', () => {
                const addr = server.address();

                if (!addr || typeof addr === 'string') {
                    reject(new Error('Failed to get server address'));
                    return;
                }

                this.lockfilePath = writeLockfile(addr.port);
                this.logger.info(`Bridge listening on port ${addr.port}`);
                resolve(addr.port);
            });

            server.on('error', (err) => {
                this.logger.error('Bridge server error:', err.message);
                reject(err);
            });
        });
    }

    dispose(): void {
        if (this.lockfilePath) {
            removeLockfile(this.lockfilePath);
            this.lockfilePath = undefined;
        }

        if (this.server) {
            this.server.close();
            this.server = undefined;
        }
    }

    private handleRequest(req: http.IncomingMessage, res: http.ServerResponse): void {
        const url = new URL(req.url ?? '/', `http://${req.headers.host}`);

        res.setHeader('Content-Type', 'application/json');

        const route = `${req.method} ${url.pathname}`;

        try {
            switch (route) {
                case 'GET /diagnostics':
                    this.handleDiagnostics(url, res);
                    break;
                case 'POST /open':
                    this.handleOpen(req, res);
                    break;
                case 'POST /file-updated':
                    this.handleFileUpdated(req, res);
                    break;
                case 'GET /selection':
                    this.handleSelection(res);
                    break;
                default:
                    res.writeHead(404);
                    res.end(JSON.stringify({ error: 'not found' }));
            }
        } catch (err) {
            this.logger.error('Request handler error:', String(err));
            res.writeHead(500);
            res.end(JSON.stringify({ error: 'internal server error' }));
        }
    }

    private handleDiagnostics(url: URL, res: http.ServerResponse): void {
        const uri = url.searchParams.get('uri');

        if (!uri) {
            const allDiagnostics = vscode.languages.getDiagnostics();
            const result: Record<string, object[]> = {};

            for (const [docUri, diags] of allDiagnostics) {
                if (diags.length > 0) {
                    result[docUri.toString()] = diags.map(serializeDiagnostic);
                }
            }

            res.writeHead(200);
            res.end(JSON.stringify(result));
            return;
        }

        const parsedUri = vscode.Uri.parse(uri);
        const diagnostics = vscode.languages.getDiagnostics(parsedUri);

        res.writeHead(200);
        res.end(JSON.stringify(diagnostics.map(serializeDiagnostic)));
    }

    private handleOpen(req: http.IncomingMessage, res: http.ServerResponse): void {
        readBody(req).then(async (body) => {
            const { path, line, column } = JSON.parse(body);

            if (!path) {
                res.writeHead(400);
                res.end(JSON.stringify({ error: 'path is required' }));
                return;
            }

            const uri = vscode.Uri.file(path);
            const doc = await vscode.workspace.openTextDocument(uri);

            const options: vscode.TextDocumentShowOptions = {};
            if (typeof line === 'number') {
                const pos = new vscode.Position(line - 1, (column ?? 1) - 1);
                options.selection = new vscode.Range(pos, pos);
            }

            await vscode.window.showTextDocument(doc, options);

            res.writeHead(200);
            res.end(JSON.stringify({ ok: true }));
        }).catch((err) => {
            this.logger.error('open handler error:', String(err));
            res.writeHead(500);
            res.end(JSON.stringify({ error: String(err) }));
        });
    }

    private handleFileUpdated(req: http.IncomingMessage, res: http.ServerResponse): void {
        readBody(req).then(async (body) => {
            const { path } = JSON.parse(body);

            if (!path) {
                res.writeHead(400);
                res.end(JSON.stringify({ error: 'path is required' }));
                return;
            }

            try {
                const uri = vscode.Uri.file(path);
                await vscode.workspace.openTextDocument(uri);
            } catch {
                // File may not exist yet or be outside workspace — not an error
            }

            res.writeHead(200);
            res.end(JSON.stringify({ ok: true }));
        }).catch((err) => {
            this.logger.error('file-updated handler error:', String(err));
            res.writeHead(500);
            res.end(JSON.stringify({ error: String(err) }));
        });
    }

    private handleSelection(res: http.ServerResponse): void {
        const editor = vscode.window.activeTextEditor;

        if (!editor || editor.selection.isEmpty) {
            res.writeHead(204);
            res.end();
            return;
        }

        const selection = editor.selection;
        const text = editor.document.getText(selection);

        res.writeHead(200);
        res.end(JSON.stringify({
            file: editor.document.uri.fsPath,
            text,
            start: { line: selection.start.line + 1, character: selection.start.character + 1 },
            end: { line: selection.end.line + 1, character: selection.end.character + 1 },
        }));
    }
}

function serializeDiagnostic(d: vscode.Diagnostic): object {
    return {
        range: {
            start: { line: d.range.start.line, character: d.range.start.character },
            end: { line: d.range.end.line, character: d.range.end.character },
        },
        severity: diagnosticSeverity(d.severity),
        message: d.message,
        source: d.source ?? '',
        code: typeof d.code === 'object' ? String(d.code.value) : String(d.code ?? ''),
    };
}

function diagnosticSeverity(severity: vscode.DiagnosticSeverity): number {
    // VS Code's enum is 0-indexed (Error=0, Warning=1, Info=2, Hint=3)
    // LSP is 1-indexed (Error=1, Warning=2, Info=3, Hint=4)
    return severity + 1;
}

function readBody(req: http.IncomingMessage): Promise<string> {
    return new Promise((resolve, reject) => {
        const chunks: Buffer[] = [];

        req.on('data', (chunk: Buffer) => chunks.push(chunk));
        req.on('end', () => resolve(Buffer.concat(chunks).toString()));
        req.on('error', reject);
    });
}


function writeLockfile(port: number): string {
    mkdirSync(lockfileDir, { recursive: true });

    const data = {
        port,
        pid: process.pid,
        workspaces: vscode.workspace.workspaceFolders?.map(f => f.uri.fsPath) ?? [],
        startedAt: new Date().toISOString(),
    };

    const lockfilePath = join(lockfileDir, `${port}.lock`);
    writeFileSync(lockfilePath, JSON.stringify(data, null, 2));

    return lockfilePath;
}

function removeLockfile(lockfilePath: string): void {
    try { unlinkSync(lockfilePath); } catch { }
}

function cleanStaleLockfiles(): void {
    try {
        for (const file of readdirSync(lockfileDir)) {
            if (!file.endsWith('.lock')) {
                continue;
            }

            const fullPath = join(lockfileDir, file);
            try {
                const { pid } = JSON.parse(readFileSync(fullPath, 'utf-8'));
                try { process.kill(pid, 0); } catch { unlinkSync(fullPath); }
            } catch {
                unlinkSync(fullPath);
            }
        }
    } catch { }
}