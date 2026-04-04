import { randomUUID } from 'node:crypto';
import { mkdirSync, readdirSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs';
import { createServer, type Server } from 'node:http';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { z } from 'zod';
import * as vscode from 'vscode';

const lockfileDir = join(homedir(), '.wingman', 'bridge');

function textResult(text: string) {
    return { content: [{ type: 'text' as const, text }] };
}

const positionSchema = {
    path: z.string().describe('Absolute path to the file'),
    line: z.number().describe('Line number (1-based)'),
    column: z.number().describe('Column number (1-based)'),
};

export class Bridge implements vscode.Disposable {
    private server: Server | undefined;
    private sessions = new Map<string, StreamableHTTPServerTransport>();
    private lockfilePath: string | undefined;

    constructor(private readonly logger: vscode.LogOutputChannel) { }

    async start(): Promise<number> {
        cleanStaleLockfiles();

        return new Promise((resolve, reject) => {
            this.server = createServer(async (req, res) => {
                try {
                    const sessionId = req.headers['mcp-session-id'] as string | undefined;

                    if (sessionId) {
                        // Existing session — route to its transport
                        const transport = this.sessions.get(sessionId);
                        if (transport) {
                            await transport.handleRequest(req, res);
                        } else {
                            res.writeHead(404, { 'Content-Type': 'text/plain' });
                            res.end('Session not found');
                        }
                        return;
                    }

                    // No session ID — new client connecting. Create a fresh transport + server.
                    const transport = new StreamableHTTPServerTransport({
                        sessionIdGenerator: () => randomUUID(),
                        onsessioninitialized: (id) => {
                            this.sessions.set(id, transport);
                        },
                    });

                    transport.onclose = () => {
                        if (transport.sessionId) {
                            this.sessions.delete(transport.sessionId);
                        }
                    };

                    const mcp = this.createMcpServer();
                    await mcp.connect(transport);
                    await transport.handleRequest(req, res);
                } catch (err) {
                    this.logger.error('MCP request error:', String(err));
                    if (!res.headersSent) {
                        res.writeHead(500);
                        res.end(String(err));
                    }
                }
            });

            this.server.listen(0, '127.0.0.1', () => {
                const addr = this.server!.address();

                if (!addr || typeof addr === 'string') {
                    reject(new Error('Failed to get server address'));
                    return;
                }

                this.lockfilePath = writeLockfile(addr.port);
                resolve(addr.port);
            });

            this.server.on('error', (err) => {
                this.logger.error('Bridge server error:', err.message);
                reject(err);
            });
        });
    }

    private createMcpServer(): McpServer {
        const workspaces = vscode.workspace.workspaceFolders?.map(f => f.uri.fsPath) ?? [];

        const mcp = new McpServer({
            name: 'wingman-vscode',
            version: '0.1.0',
        }, {
            instructions: [
                'You are connected to VS Code via the Wingman bridge.',
                `Open workspaces: ${workspaces.join(', ') || 'none'}`,
                'Use the available tools to interact with the IDE: open files, get diagnostics, read the user\'s selection, and notify file changes.',
                'When you edit or write files, call notify_file_updated so the IDE language services re-analyze the changes.',
                'Use get_selection to understand what code the user is currently looking at — this provides context for their questions.',
            ].join('\n'),
        });

        // --- Tools ---

        mcp.tool(
            'get_diagnostics',
            'Get LSP diagnostics (errors, warnings) from the IDE for a file or the entire workspace.',
            { uri: z.string().optional().describe('File URI (e.g. file:///path/to/file). Omit for all diagnostics.') },
            async ({ uri }) => {
                if (uri) {
                    const parsed = vscode.Uri.parse(uri);
                    const diags = vscode.languages.getDiagnostics(parsed);
                    return textResult(JSON.stringify(diags.map(serializeDiagnostic), null, 2));
                }

                const all = vscode.languages.getDiagnostics();
                const result: Record<string, object[]> = {};
                for (const [docUri, diags] of all) {
                    if (diags.length > 0) {
                        result[docUri.toString()] = diags.map(serializeDiagnostic);
                    }
                }
                return textResult(JSON.stringify(result, null, 2));
            }
        );

        mcp.tool(
            'open_file',
            'Open a file in the IDE at an optional line and column position.',
            {
                path: z.string().describe('Absolute path to the file to open'),
                line: z.number().optional().describe('Line number to navigate to (1-based)'),
                column: z.number().optional().describe('Column number to navigate to (1-based)'),
            },
            async ({ path, line, column }) => {
                const uri = vscode.Uri.file(path);
                const doc = await vscode.workspace.openTextDocument(uri);

                const options: vscode.TextDocumentShowOptions = {};
                if (typeof line === 'number') {
                    const pos = new vscode.Position(line - 1, (column ?? 1) - 1);
                    options.selection = new vscode.Range(pos, pos);
                }

                await vscode.window.showTextDocument(doc, options);
                return textResult(`Opened ${path}${line ? ` at line ${line}` : ''}`);
            }
        );

        mcp.tool(
            'get_selection',
            'Get the current text selection in the IDE.',
            {},
            async () => {
                const editor = vscode.window.activeTextEditor;

                if (!editor || editor.selection.isEmpty) {
                    return textResult('No active selection');
                }

                const selection = editor.selection;
                return textResult(JSON.stringify({
                    file: editor.document.uri.fsPath,
                    text: editor.document.getText(selection),
                    start: { line: selection.start.line + 1, character: selection.start.character + 1 },
                    end: { line: selection.end.line + 1, character: selection.end.character + 1 },
                }, null, 2));
            }
        );

        mcp.tool(
            'notify_file_updated',
            'Notify the IDE that a file was changed externally so language services re-analyze it.',
            { path: z.string().describe('Absolute path to the updated file') },
            async ({ path }) => {
                try {
                    await vscode.workspace.openTextDocument(vscode.Uri.file(path));
                } catch {
                    // File may not exist yet — not an error
                }
                return textResult('OK');
            }
        );

        mcp.tool(
            'get_open_tabs',
            'Get the list of currently open editor tabs in the IDE.',
            {},
            async () => {
                const tabs: { path: string; isActive: boolean }[] = [];

                for (const group of vscode.window.tabGroups.all) {
                    for (const tab of group.tabs) {
                        if (tab.input instanceof vscode.TabInputText) {
                            tabs.push({ path: tab.input.uri.fsPath, isActive: tab.isActive });
                        }
                    }
                }

                return textResult(JSON.stringify(tabs, null, 2));
            }
        );

        mcp.tool(
            'get_document_symbols',
            'Get the symbol outline (functions, classes, variables, etc.) of a file. Much faster than reading the entire file for understanding structure.',
            { path: z.string().describe('Absolute path to the file') },
            async ({ path }) => {
                const symbols = await vscode.commands.executeCommand<vscode.DocumentSymbol[]>(
                    'vscode.executeDocumentSymbolProvider', vscode.Uri.file(path)
                );

                if (!symbols || symbols.length === 0) {
                    return textResult('No symbols found');
                }

                return textResult(JSON.stringify(flattenSymbols(symbols), null, 2));
            }
        );

        mcp.tool(
            'find_references',
            'Find all references to a symbol at a given position across the workspace. Uses the IDE\'s language intelligence.',
            positionSchema,
            async ({ path, line, column }) => {
                const locations = await vscode.commands.executeCommand<vscode.Location[]>(
                    'vscode.executeReferenceProvider',
                    vscode.Uri.file(path),
                    new vscode.Position(line - 1, column - 1),
                );

                if (!locations || locations.length === 0) {
                    return textResult('No references found');
                }

                return textResult(JSON.stringify(locations.map(loc => ({
                    path: loc.uri.fsPath,
                    line: loc.range.start.line + 1,
                    character: loc.range.start.character + 1,
                })), null, 2));
            }
        );

        mcp.tool(
            'go_to_definition',
            'Find the definition of a symbol at a given position. Uses the IDE\'s language intelligence.',
            positionSchema,
            async ({ path, line, column }) => {
                const locations = await vscode.commands.executeCommand<(vscode.Location | vscode.LocationLink)[]>(
                    'vscode.executeDefinitionProvider',
                    vscode.Uri.file(path),
                    new vscode.Position(line - 1, column - 1),
                );

                if (!locations || locations.length === 0) {
                    return textResult('No definition found');
                }

                return textResult(JSON.stringify(locations.map(loc => {
                    if ('targetUri' in loc) {
                        return {
                            path: loc.targetUri.fsPath,
                            line: loc.targetRange.start.line + 1,
                            character: loc.targetRange.start.character + 1,
                        };
                    }
                    return {
                        path: loc.uri.fsPath,
                        line: loc.range.start.line + 1,
                        character: loc.range.start.character + 1,
                    };
                }), null, 2));
            }
        );

        return mcp;
    }

    dispose(): void {
        if (this.lockfilePath) {
            removeLockfile(this.lockfilePath);
            this.lockfilePath = undefined;
        }

        for (const transport of this.sessions.values()) {
            transport.close();
        }
        this.sessions.clear();

        if (this.server) {
            this.server.close();
            this.server = undefined;
        }
    }
}

function serializeDiagnostic(d: vscode.Diagnostic): object {
    return {
        range: {
            start: { line: d.range.start.line, character: d.range.start.character },
            end: { line: d.range.end.line, character: d.range.end.character },
        },
        severity: d.severity + 1,
        message: d.message,
        source: d.source ?? '',
        code: typeof d.code === 'object' ? String(d.code.value) : String(d.code ?? ''),
    };
}

function writeLockfile(port: number): string {
    mkdirSync(lockfileDir, { recursive: true });

    const data = {
        url: `http://127.0.0.1:${port}`,
        pid: process.pid,
        workspaces: vscode.workspace.workspaceFolders?.map(f => f.uri.fsPath) ?? [],
    };

    const lockfilePath = join(lockfileDir, `${port}.lock`);
    writeFileSync(lockfilePath, JSON.stringify(data, null, 2));

    return lockfilePath;
}

function removeLockfile(lockfilePath: string): void {
    try { unlinkSync(lockfilePath); } catch { }
}

interface FlatSymbol {
    name: string;
    kind: string;
    line: number;
    character: number;
    container?: string;
}

function flattenSymbols(symbols: vscode.DocumentSymbol[], container?: string): FlatSymbol[] {
    const result: FlatSymbol[] = [];

    for (const sym of symbols) {
        result.push({
            name: sym.name,
            kind: vscode.SymbolKind[sym.kind],
            line: sym.range.start.line + 1,
            character: sym.range.start.character + 1,
            ...(container ? { container } : {}),
        });

        if (sym.children.length > 0) {
            result.push(...flattenSymbols(sym.children, sym.name));
        }
    }

    return result;
}

function cleanStaleLockfiles(): void {
    try {
        for (const file of readdirSync(lockfileDir)) {
            if (!file.endsWith('.lock')) { continue; }
            const fullPath = join(lockfileDir, file);
            try {
                const { pid } = JSON.parse(readFileSync(fullPath, 'utf-8'));
                try { process.kill(pid, 0); } catch { unlinkSync(fullPath); }
            } catch { unlinkSync(fullPath); }
        }
    } catch { }
}
