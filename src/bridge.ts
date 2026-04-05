import { randomUUID } from 'node:crypto';
import { mkdirSync, readdirSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs';
import type { ServerType } from '@hono/node-server';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { serve } from '@hono/node-server';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { WebStandardStreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js';
import { Hono } from 'hono';
import { z } from 'zod';
import * as vscode from 'vscode';

const lockfileDir = join(homedir(), '.wingman', 'bridge');

const positionSchema = {
    path: z.string().describe('Absolute path to the file'),
    line: z.number().describe('Line number (0-based)'),
    column: z.number().describe('Column number (0-based)'),
};

// --- Session state ---

interface Session {
    transport: WebStandardStreamableHTTPServerTransport;
    mcp: McpServer;
}

export class Bridge implements vscode.Disposable {
    private server: ServerType | undefined;
    private sessions = new Map<string, Session>();
    private lockfilePath: string | undefined;
    private disposables: vscode.Disposable[] = [];

    constructor(private readonly logger: vscode.LogOutputChannel) { }

    async start(): Promise<number> {
        cleanStaleLockfiles();

        const app = new Hono();

        // --- MCP endpoint ---

        app.all('/mcp', async (c) => {
            try {
                const sessionId = c.req.header('mcp-session-id');

                if (sessionId) {
                    const session = this.sessions.get(sessionId);
                    if (!session) {
                        return c.text('Session not found', 404);
                    }
                    return session.transport.handleRequest(c.req.raw);
                }

                // New client connecting — create a fresh transport + server.
                const transport = new WebStandardStreamableHTTPServerTransport({
                    sessionIdGenerator: () => randomUUID(),
                    onsessioninitialized: (id) => {
                        this.sessions.set(id, { transport, mcp });
                    },
                });

                transport.onclose = () => {
                    if (transport.sessionId) {
                        this.sessions.delete(transport.sessionId);
                    }
                };

                const mcp = this.createMcpServer();

                await mcp.connect(transport);
                return transport.handleRequest(c.req.raw);
            } catch (err) {
                this.logger.error('MCP request error:', String(err));
                return c.text(String(err), 500);
            }
        });

        // --- Workspace state change notifications (via resource subscription) ---

        const throttledStateNotify = throttle(
            () => this.notifyWorkspaceStateChanged(),
            100,
        );

        this.disposables.push(
            vscode.window.onDidChangeTextEditorSelection((e) => {
                if (e.selections[0]) {
                    throttledStateNotify();
                }
            }),

            vscode.window.onDidChangeActiveTextEditor(() => {
                throttledStateNotify();
            }),

            vscode.workspace.onDidOpenTextDocument((doc) => {
                if (doc.uri.scheme === 'file') {
                    throttledStateNotify();
                }
            }),

            vscode.workspace.onDidCloseTextDocument((doc) => {
                if (doc.uri.scheme === 'file') {
                    throttledStateNotify();
                }
            }),

            vscode.window.tabGroups.onDidChangeTabs(() => {
                throttledStateNotify();
            }),
        );

        // --- Start server ---

        return new Promise((resolve, reject) => {
            this.server = serve({
                fetch: app.fetch,
                port: 0,
                hostname: '127.0.0.1',
            }, (info) => {
                this.lockfilePath = writeLockfile(info.port);
                resolve(info.port);
            });

            this.server.on('error', (err) => {
                this.logger.error('Bridge server error:', err.message);
                reject(err);
            });
        });
    }

    private notifyWorkspaceStateChanged(): void {
        for (const { mcp } of this.sessions.values()) {
            mcp.server.sendResourceUpdated({ uri: 'wingman://workspace/state' }).catch(() => { });
        }
    }

    private createMcpServer(): McpServer {
        const workspaces = vscode.workspace.workspaceFolders?.map(f => f.uri.fsPath) ?? [];

        const mcp = new McpServer({
            name: 'wingman-vscode',
            version: '0.1.0',
        }, {
            instructions: 'You are connected to VS Code.',
        });

        // --- Tools ---

        mcp.registerTool(
            'get_diagnostics',
            {
                description: 'Get LSP diagnostics (errors, warnings) from the IDE for a file or the entire workspace.',
                inputSchema: { path: z.string().optional().describe('Absolute file path. Omit for all diagnostics.') },
            },
            async ({ path }) => {
                if (path) {
                    const uri = vscode.Uri.file(path);
                    const diags = vscode.languages.getDiagnostics(uri);
                    return textResult(JSON.stringify(diags.map(serializeDiagnostic), null, 2));
                }

                const all = vscode.languages.getDiagnostics();
                const result: Record<string, object[]> = {};
                for (const [uri, diags] of all) {
                    if (diags.length > 0) {
                        result[uri.fsPath] = diags.map(serializeDiagnostic);
                    }
                }
                return textResult(JSON.stringify(result, null, 2));
            }
        );

        mcp.registerTool(
            'open_file',
            {
                description: 'Open a file in the IDE at an optional line and column position.',
                inputSchema: {
                    path: z.string().describe('Absolute path to the file to open'),
                    line: z.number().optional().describe('Line number to navigate to (0-based)'),
                    column: z.number().optional().describe('Column number to navigate to (0-based)'),
                },
            },
            async ({ path, line, column }) => {
                const uri = vscode.Uri.file(path);
                const doc = await vscode.workspace.openTextDocument(uri);

                const options: vscode.TextDocumentShowOptions = {};
                if (typeof line === 'number') {
                    const pos = new vscode.Position(line, column ?? 0);
                    options.selection = new vscode.Range(pos, pos);
                }

                await vscode.window.showTextDocument(doc, options);
                return textResult(`Opened ${path}${typeof line === 'number' ? ` at line ${line}` : ''}`);
            }
        );

        mcp.registerTool(
            'notify_file_updated',
            {
                description: 'Notify the IDE that a file was changed externally so language services re-analyze it.',
                inputSchema: {
                    path: z.string().describe('Absolute path to the updated file'),
                },
            },
            async ({ path }) => {
                try {
                    await vscode.workspace.openTextDocument(vscode.Uri.file(path));
                } catch {
                    // File may not exist yet — not an error
                }

                return textResult('OK');
            }
        );

        mcp.registerTool(
            'get_document_symbols',
            {
                description: 'Get the symbol outline (functions, classes, variables, etc.) of a file. Much faster than reading the entire file for understanding structure.',
                inputSchema: { path: z.string().describe('Absolute path to the file') },
            },
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

        mcp.registerTool(
            'find_references',
            {
                description: 'Find all references to a symbol at a given position across the workspace.',
                inputSchema: positionSchema,
            },
            async ({ path, line, column }) => {
                const locations = await vscode.commands.executeCommand<vscode.Location[]>(
                    'vscode.executeReferenceProvider',
                    vscode.Uri.file(path),
                    new vscode.Position(line, column),
                );

                if (!locations || locations.length === 0) {
                    return textResult('No references found');
                }

                return textResult(JSON.stringify(locations.map(serializeLocation), null, 2));
            }
        );

        mcp.registerTool(
            'go_to_definition',
            {
                description: 'Find the definition of a symbol at a given position.',
                inputSchema: positionSchema,
            },
            async ({ path, line, column }) => {
                const locations = await vscode.commands.executeCommand<(vscode.Location | vscode.LocationLink)[]>(
                    'vscode.executeDefinitionProvider',
                    vscode.Uri.file(path),
                    new vscode.Position(line, column),
                );

                if (!locations || locations.length === 0) {
                    return textResult('No definition found');
                }

                return textResult(JSON.stringify(locations.map(serializeLocation), null, 2));
            }
        );

        mcp.registerTool(
            'go_to_implementation',
            {
                description: 'Find implementations of an interface or abstract method at a given position.',
                inputSchema: positionSchema,
            },
            async ({ path, line, column }) => {
                const locations = await vscode.commands.executeCommand<(vscode.Location | vscode.LocationLink)[]>(
                    'vscode.executeImplementationProvider',
                    vscode.Uri.file(path),
                    new vscode.Position(line, column),
                );

                if (!locations || locations.length === 0) {
                    return textResult('No implementations found');
                }

                return textResult(JSON.stringify(locations.map(serializeLocation), null, 2));
            }
        );

        mcp.registerTool(
            'go_to_type_definition',
            {
                description: 'Find the type definition of a symbol at a given position.',
                inputSchema: positionSchema,
            },
            async ({ path, line, column }) => {
                const locations = await vscode.commands.executeCommand<(vscode.Location | vscode.LocationLink)[]>(
                    'vscode.executeTypeDefinitionProvider',
                    vscode.Uri.file(path),
                    new vscode.Position(line, column),
                );

                if (!locations || locations.length === 0) {
                    return textResult('No type definition found');
                }

                return textResult(JSON.stringify(locations.map(serializeLocation), null, 2));
            }
        );

        mcp.registerTool(
            'get_hover',
            {
                description: 'Get hover information (type info, documentation) for a symbol at a given position.',
                inputSchema: positionSchema,
            },
            async ({ path, line, column }) => {
                const hovers = await vscode.commands.executeCommand<vscode.Hover[]>(
                    'vscode.executeHoverProvider',
                    vscode.Uri.file(path),
                    new vscode.Position(line, column),
                );

                if (!hovers || hovers.length === 0) {
                    return textResult('No hover information');
                }

                const contents = hovers.flatMap(h =>
                    h.contents.map(c => c instanceof vscode.MarkdownString ? c.value : typeof c === 'string' ? c : '')
                ).filter(Boolean);

                return textResult(contents.join('\n\n'));
            }
        );

        mcp.registerTool(
            'get_call_hierarchy',
            {
                description: 'Get incoming and outgoing calls for a function/method at a given position.',
                inputSchema: {
                    ...positionSchema,
                    direction: z.enum(['incoming', 'outgoing']).describe('Direction of the call hierarchy'),
                },
            },
            async ({ path, line, column, direction }) => {
                const items = await vscode.commands.executeCommand<vscode.CallHierarchyItem[]>(
                    'vscode.prepareCallHierarchy',
                    vscode.Uri.file(path),
                    new vscode.Position(line, column),
                );

                if (!items || items.length === 0) {
                    return textResult('No call hierarchy available');
                }

                const command = direction === 'incoming'
                    ? 'vscode.provideIncomingCalls'
                    : 'vscode.provideOutgoingCalls';

                const calls = await vscode.commands.executeCommand<
                    (vscode.CallHierarchyIncomingCall | vscode.CallHierarchyOutgoingCall)[]
                >(command, items[0]);

                if (!calls || calls.length === 0) {
                    return textResult(`No ${direction} calls found`);
                }

                const result = calls.map(call => {
                    const item = 'from' in call ? call.from : call.to;
                    return {
                        name: item.name,
                        kind: vscode.SymbolKind[item.kind],
                        path: item.uri.fsPath,
                        line: item.range.start.line,
                        character: item.range.start.character,
                    };
                });

                return textResult(JSON.stringify(result, null, 2));
            }
        );

        // --- Resources ---

        mcp.registerResource(
            'workspace_state',
            'wingman://workspace/state',
            { description: 'Current IDE workspace state: active file, selection, and open files.' },
            () => {
                const editor = vscode.window.activeTextEditor;

                const openFiles: string[] = [];
                for (const group of vscode.window.tabGroups.all) {
                    for (const tab of group.tabs) {
                        if (tab.input instanceof vscode.TabInputText) {
                            openFiles.push(tab.input.uri.fsPath);
                        }
                    }
                }

                const state: Record<string, unknown> = {
                    workspaces,
                    activeFile: editor?.document.uri.fsPath ?? null,
                    openFiles,
                };

                if (editor && !editor.selection.isEmpty) {
                    const sel = editor.selection;
                    state.selection = {
                        filePath: editor.document.uri.fsPath,
                        start: { line: sel.start.line, character: sel.start.character },
                        end: { line: sel.end.line, character: sel.end.character },
                        text: editor.document.getText(sel),
                    };
                }

                return { contents: [{ uri: 'wingman://workspace/state', text: JSON.stringify(state, null, 2) }] };
            }
        );

        return mcp;
    }

    dispose(): void {
        for (const d of this.disposables) {
            d.dispose();
        }
        this.disposables = [];

        if (this.lockfilePath) {
            removeLockfile(this.lockfilePath);
            this.lockfilePath = undefined;
        }

        for (const { mcp, transport } of this.sessions.values()) {
            mcp.close().catch(() => { });
            transport.close();
        }
        this.sessions.clear();

        if (this.server) {
            this.server.close();
            this.server = undefined;
        }
    }
}

// --- Helpers & utilities ---

function textResult(text: string) {
    return { content: [{ type: 'text' as const, text }] };
}

const severityLabel: Record<number, string> = {
    [vscode.DiagnosticSeverity.Error]: 'Error',
    [vscode.DiagnosticSeverity.Warning]: 'Warning',
    [vscode.DiagnosticSeverity.Information]: 'Info',
    [vscode.DiagnosticSeverity.Hint]: 'Hint',
};

function serializeDiagnostic(d: vscode.Diagnostic): object {
    return {
        range: {
            start: { line: d.range.start.line, character: d.range.start.character },
            end: { line: d.range.end.line, character: d.range.end.character },
        },
        severity: severityLabel[d.severity] ?? 'Error',
        message: d.message,
        source: d.source ?? '',
        code: typeof d.code === 'object' ? String(d.code.value) : String(d.code ?? ''),
    };
}

function serializeLocation(loc: vscode.Location | vscode.LocationLink): object {
    if ('targetUri' in loc) {
        return {
            path: loc.targetUri.fsPath,
            line: loc.targetRange.start.line,
            character: loc.targetRange.start.character,
        };
    }
    return {
        path: loc.uri.fsPath,
        line: loc.range.start.line,
        character: loc.range.start.character,
    };
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
            line: sym.range.start.line,
            character: sym.range.start.character,
            ...(container ? { container } : {}),
        });

        if (sym.children.length > 0) {
            result.push(...flattenSymbols(sym.children, sym.name));
        }
    }

    return result;
}

function throttle<T extends (...args: never[]) => void>(fn: T, ms: number): T {
    let timer: ReturnType<typeof setTimeout> | undefined;
    let lastArgs: Parameters<T> | undefined;

    return ((...args: Parameters<T>) => {
        lastArgs = args;
        if (timer) { return; }
        timer = setTimeout(() => {
            timer = undefined;
            fn(...lastArgs!);
        }, ms);
    }) as T;
}

function writeLockfile(port: number): string {
    mkdirSync(lockfileDir, { recursive: true });

    const data = {
        url: `http://127.0.0.1:${port}/mcp`,
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
