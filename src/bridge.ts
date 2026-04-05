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
            instructions: [
                'You are connected to a VS Code instance via MCP.',
                'Use these tools to interact with the IDE: navigate files, inspect code, and leverage language intelligence.',
                'After editing files externally, call notify_file_updated so the IDE re-analyzes them.',
                'Use get_lsp_diagnostics to check for errors after changes.',
                'Prefer LSP tools (find_lsp_*, get_lsp_*) over text-based search when you need semantic understanding of code.',
            ].join(' '),
        });

        // --- Tools ---

        mcp.registerTool(
            'get_lsp_diagnostics',
            {
                description: 'Get LSP diagnostics (errors, warnings, hints) for a file or the entire workspace. Use after editing files to verify correctness.',
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
                description: 'Open a file in the IDE editor. Supports navigating to a line/column, viewing a file at a git ref, or showing a diff against a git ref.',
                inputSchema: {
                    path: z.string().describe('Absolute path to the file to open'),
                    line: z.number().optional().describe('Line number to navigate to (0-based)'),
                    column: z.number().optional().describe('Column number to navigate to (0-based)'),
                    view: z.enum(['diff']).optional().describe('View mode. "diff" shows changes against git HEAD (or the ref if specified).'),
                    ref: z.string().optional().describe('Git ref to diff against (e.g. "HEAD~3", "main", a commit hash). Defaults to HEAD. Only used with view="diff".'),
                },
            },
            async ({ path, line, column, view, ref }) => {
                const uri = vscode.Uri.file(path);

                if (view === 'diff') {
                    const gitRef = ref ?? '~';
                    const gitUri = uri.with({ scheme: 'git', query: JSON.stringify({ path: path, ref: gitRef }) });
                    const options: vscode.TextDocumentShowOptions = { preserveFocus: true, preview: false };
                    await vscode.commands.executeCommand('vscode.diff', gitUri, uri, `${path.split('/').pop()} (Working Tree)`, options);
                    return textResult(`Opened diff for ${path}`);
                }

                if (ref) {
                    const gitUri = uri.with({ scheme: 'git', query: JSON.stringify({ path: path, ref }) });
                    const doc = await vscode.workspace.openTextDocument(gitUri);
                    await vscode.window.showTextDocument(doc, { preview: false });
                    return textResult(`Opened ${path} at ref ${ref}`);
                }

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
                description: 'Notify the IDE that a file was changed externally so LSP language services re-analyze it. Call this after writing or modifying files outside the editor.',
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
            'find_lsp_symbols',
            {
                description: 'Find LSP symbols. With a path: returns the symbol outline (functions, classes, variables) of that file. Without a path: searches symbols across the entire workspace by query. Faster and more accurate than text-based grep for understanding code structure.',
                inputSchema: {
                    path: z.string().optional().describe('Absolute path to a file. If provided, returns symbols in that file.'),
                    query: z.string().optional().describe('Search query for workspace-wide symbol search. Used when path is omitted.'),
                },
            },
            async ({ path, query }) => {
                if (path) {
                    const symbols = await vscode.commands.executeCommand<vscode.DocumentSymbol[]>(
                        'vscode.executeDocumentSymbolProvider', vscode.Uri.file(path)
                    );

                    if (!symbols || symbols.length === 0) {
                        return textResult('No symbols found');
                    }

                    return textResult(JSON.stringify(flattenSymbols(symbols), null, 2));
                }

                const symbols = await vscode.commands.executeCommand<vscode.SymbolInformation[]>(
                    'vscode.executeWorkspaceSymbolProvider', query ?? ''
                );

                if (!symbols || symbols.length === 0) {
                    return textResult('No symbols found');
                }

                const result = symbols.map(s => ({
                    name: s.name,
                    kind: vscode.SymbolKind[s.kind],
                    path: s.location.uri.fsPath,
                    line: s.location.range.start.line,
                    character: s.location.range.start.character,
                    container: s.containerName || undefined,
                }));

                return textResult(JSON.stringify(result, null, 2));
            }
        );

        mcp.registerTool(
            'find_lsp_references',
            {
                description: 'Find all LSP references to a symbol at a given position across the workspace. Use to understand usage patterns before renaming or refactoring.',
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
            'find_lsp_definition',
            {
                description: 'Find the LSP definition of a symbol at a given position. Use to navigate to where a function, type, or variable is declared.',
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
            'find_lsp_implementation',
            {
                description: 'Find LSP implementations of an interface or abstract method at a given position. Use to discover concrete types that implement an interface.',
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
            'get_lsp_hover',
            {
                description: 'Get LSP hover information (type info, documentation) for a symbol at a given position. Use to inspect types, signatures, and docs without reading the full source.',
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
            'find_lsp_hierarchy',
            {
                description: 'Find LSP call hierarchy for a function/method at a given position. Use to trace call chains — who calls this function (incoming) or what it calls (outgoing).',
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
