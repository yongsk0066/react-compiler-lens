import * as crypto from 'node:crypto';
import { TextDocument } from 'vscode-languageserver-textdocument';
import {
  CodeLens,
  createConnection,
  Diagnostic,
  DiagnosticSeverity,
  type InitializeParams,
  type InitializeResult,
  NotificationType,
  ProposedFeatures,
  Range,
  TextDocuments,
  TextDocumentSyncKind,
} from 'vscode-languageserver/node';
import { Analyzer } from './analyzer';
import { detectFramework } from './framework';
import type {
  FileAnalysisResult,
  DeclaredComponentAnalysis,
  ImportedComponentAnalysis,
  Directive,
  Framework,
} from '@react-compiler-lens/shared';

// -------------------------------------------------------------------
// Notification types (server → client)
// -------------------------------------------------------------------

interface CompiledCodeParams {
  uri: string;
  code: string;
}

const CompiledCodeNotification = new NotificationType<CompiledCodeParams>(
  'react-compiler-lens/compiledCode',
);

// -------------------------------------------------------------------
// Config interface
// -------------------------------------------------------------------

interface Config {
  enabled: boolean;
  serverComponent: boolean;
  clientComponent: boolean;
  compilationStatus: boolean;
  diagnosticsEnabled: boolean;
  diagnosticsSeverity: string;
  framework: string;
}

const defaultConfig: Config = {
  enabled: true,
  serverComponent: true,
  clientComponent: true,
  compilationStatus: true,
  diagnosticsEnabled: true,
  diagnosticsSeverity: 'warning',
  framework: 'auto',
};

// -------------------------------------------------------------------
// LSP connection & document manager
// -------------------------------------------------------------------

const connection = createConnection(ProposedFeatures.all);
const documents = new TextDocuments(TextDocument);

// -------------------------------------------------------------------
// Runtime state
// -------------------------------------------------------------------

let analyzer: Analyzer | null = null;
let workspaceRoot: string | null = null;
let config: Config = { ...defaultConfig };

/** Cache of analysis results keyed by document URI */
const analysisCache = new Map<string, FileAnalysisResult>();

/** MD5 hashes of last-analyzed content, keyed by URI */
const contentHashCache = new Map<string, string>();

/** Pending debounce timers, keyed by URI */
const debounceTimers = new Map<string, ReturnType<typeof setTimeout>>();

const DEBOUNCE_MS = 200;

// -------------------------------------------------------------------
// Helpers
// -------------------------------------------------------------------

function md5(content: string): string {
  return crypto.createHash('md5').update(content).digest('hex');
}

function getKindLabel(directive: Directive, framework: Framework): string {
  if (directive === 'use client') return 'Client Component';
  if (directive === 'use server') return 'Server Component';
  // null directive
  if (framework === 'nextjs') return 'Server Component';
  return 'Component';
}

function mapSeverity(severityStr: string): DiagnosticSeverity {
  switch (severityStr) {
    case 'error':
      return DiagnosticSeverity.Error;
    case 'info':
      return DiagnosticSeverity.Information;
    case 'warning':
    default:
      return DiagnosticSeverity.Warning;
  }
}

// -------------------------------------------------------------------
// Initialize
// -------------------------------------------------------------------

connection.onInitialize((params: InitializeParams): InitializeResult => {
  workspaceRoot = params.rootUri
    ? params.rootUri.replace(/^file:\/\//, '')
    : params.rootPath ?? null;

  const framework: Framework =
    config.framework !== 'auto'
      ? (config.framework as Framework)
      : workspaceRoot
        ? detectFramework(workspaceRoot)
        : 'none';

  analyzer = new Analyzer({ framework });

  return {
    capabilities: {
      textDocumentSync: TextDocumentSyncKind.Incremental,
      codeLensProvider: { resolveProvider: false },
    },
  };
});

// -------------------------------------------------------------------
// Configuration sync
// -------------------------------------------------------------------

connection.onDidChangeConfiguration(change => {
  const settings = (change.settings as { reactCompilerLens?: Record<string, unknown> })
    ?.reactCompilerLens ?? {};

  config = {
    enabled: (settings['enabled'] as boolean) ?? defaultConfig.enabled,
    serverComponent:
      ((settings['codeLens'] as Record<string, unknown> | undefined)?.['serverComponent'] as boolean) ??
      defaultConfig.serverComponent,
    clientComponent:
      ((settings['codeLens'] as Record<string, unknown> | undefined)?.['clientComponent'] as boolean) ??
      defaultConfig.clientComponent,
    compilationStatus:
      ((settings['codeLens'] as Record<string, unknown> | undefined)?.['compilationStatus'] as boolean) ??
      defaultConfig.compilationStatus,
    diagnosticsEnabled:
      ((settings['diagnostics'] as Record<string, unknown> | undefined)?.['enabled'] as boolean) ??
      defaultConfig.diagnosticsEnabled,
    diagnosticsSeverity:
      ((settings['diagnostics'] as Record<string, unknown> | undefined)?.['severity'] as string) ??
      defaultConfig.diagnosticsSeverity,
    framework: (settings['framework'] as string) ?? defaultConfig.framework,
  };

  // Re-create analyzer if framework override changed
  if (config.framework !== 'auto') {
    analyzer = new Analyzer({ framework: config.framework as Framework });
  } else if (workspaceRoot) {
    analyzer = new Analyzer({ framework: detectFramework(workspaceRoot) });
  }

  // Re-analyze all open documents
  for (const doc of documents.all()) {
    scheduleAnalysis(doc);
  }
});

// -------------------------------------------------------------------
// Document change handler
// -------------------------------------------------------------------

documents.onDidChangeContent(change => {
  scheduleAnalysis(change.document);
});

documents.onDidClose(event => {
  const uri = event.document.uri;

  // Cancel any pending timer
  const timer = debounceTimers.get(uri);
  if (timer !== undefined) {
    clearTimeout(timer);
    debounceTimers.delete(uri);
  }

  // Clear caches
  analysisCache.delete(uri);
  contentHashCache.delete(uri);

  // Clear diagnostics
  connection.sendDiagnostics({ uri, diagnostics: [] });
});

// -------------------------------------------------------------------
// Debounced analysis trigger
// -------------------------------------------------------------------

function scheduleAnalysis(document: TextDocument): void {
  const uri = document.uri;

  const existing = debounceTimers.get(uri);
  if (existing !== undefined) {
    clearTimeout(existing);
  }

  const timer = setTimeout(() => {
    debounceTimers.delete(uri);
    void runAnalysis(document);
  }, DEBOUNCE_MS);

  debounceTimers.set(uri, timer);
}

async function runAnalysis(document: TextDocument): Promise<void> {
  if (!config.enabled || !analyzer) return;

  const uri = document.uri;
  const content = document.getText();
  const hash = md5(content);

  // Skip if content unchanged
  if (contentHashCache.get(uri) === hash) return;
  contentHashCache.set(uri, hash);

  // Convert URI to file path
  const filePath = uri.startsWith('file://') ? decodeURIComponent(uri.slice(7)) : uri;

  let result: FileAnalysisResult;
  try {
    result = await analyzer.analyze(filePath, content);
  } catch {
    return;
  }

  analysisCache.set(uri, result);

  // Publish diagnostics
  if (config.diagnosticsEnabled) {
    publishDiagnostics(uri, result);
  } else {
    connection.sendDiagnostics({ uri, diagnostics: [] });
  }

  // Send compiled code notification if any component succeeded and compiled code is available
  if (result.compiledCode && result.declaredComponents.some(c => c.compileResult.status === 'success')) {
    connection.sendNotification(CompiledCodeNotification, {
      uri,
      code: result.compiledCode,
    });
  }
}

// -------------------------------------------------------------------
// Diagnostics publisher
// -------------------------------------------------------------------

function publishDiagnostics(uri: string, result: FileAnalysisResult): void {
  const diagnostics: Diagnostic[] = [];
  const severity = mapSeverity(config.diagnosticsSeverity);

  for (const comp of result.declaredComponents) {
    if (comp.compileResult.status !== 'error') continue;

    for (const info of comp.compileResult.diagnostics) {
      // Use reported location if available, else fall back to component declaration line
      const line = info.line !== null ? info.line - 1 : Math.max(0, comp.location.line - 1);
      const col = info.column !== null ? info.column : comp.location.column;

      const diag: Diagnostic = {
        range: Range.create(line, col, line, col + 1),
        severity,
        source: 'react-compiler',
        message: `[${comp.name}] ${info.message}`,
      };
      diagnostics.push(diag);
    }
  }

  // CompileDiagnostic events → Information severity
  for (const info of result.compilerDiagnostics) {
    const line = info.line !== null ? info.line - 1 : 0;
    const col = info.column ?? 0;
    diagnostics.push({
      range: Range.create(line, col, line, col + 1),
      severity: DiagnosticSeverity.Information,
      source: 'react-compiler',
      message: info.message,
    });
  }

  connection.sendDiagnostics({ uri, diagnostics });
}

// -------------------------------------------------------------------
// CodeLens handler
// -------------------------------------------------------------------

connection.onCodeLens(params => {
  const uri = params.textDocument.uri;
  const result = analysisCache.get(uri);

  if (!result || !config.enabled) return [];

  const lenses: CodeLens[] = [];

  // --- Declared components ---
  for (const comp of result.declaredComponents) {
    const kindLabel = getKindLabel(comp.directive, result.framework);

    // Respect config toggles
    if (comp.directive === 'use server' && !config.serverComponent) continue;
    if (comp.directive === 'use client' && !config.clientComponent) continue;
    // For null directive in nextjs, it's a server component
    if (
      comp.directive === null &&
      result.framework === 'nextjs' &&
      !config.serverComponent
    )
      continue;

    const line = Math.max(0, comp.location.line - 1);
    const col = comp.location.column;
    const range = Range.create(line, col, line, col);

    if (config.compilationStatus) {
      const lens = buildDeclaredComponentLens(comp, kindLabel, range, uri);
      lenses.push(lens);
    } else {
      // Show kind only, no compile status, no command
      lenses.push(CodeLens.create(range, {
        title: kindLabel,
        command: '',
        arguments: [],
      }));
    }
  }

  // --- Imported components ---
  for (const imp of result.importedComponents) {
    const kindLabel = getKindLabel(imp.directive, result.framework);

    if (imp.directive === 'use server' && !config.serverComponent) continue;
    if (imp.directive === 'use client' && !config.clientComponent) continue;
    if (
      imp.directive === null &&
      result.framework === 'nextjs' &&
      !config.serverComponent
    )
      continue;

    // Import location lens
    {
      const line = Math.max(0, imp.importLocation.line - 1);
      const col = imp.importLocation.column;
      const range = Range.create(line, col, line, col);
      lenses.push(CodeLens.create(range, {
        title: kindLabel,
        command: '',
        arguments: [],
      }));
    }

    // JSX usage lenses
    for (const jsxLoc of imp.jsxLocations) {
      const line = Math.max(0, jsxLoc.line - 1);
      const col = jsxLoc.column;
      const range = Range.create(line, col, line, col);
      lenses.push(CodeLens.create(range, {
        title: kindLabel,
        command: '',
        arguments: [],
      }));
    }
  }

  return lenses;
});

function buildDeclaredComponentLens(
  comp: DeclaredComponentAnalysis,
  kindLabel: string,
  range: Range,
  uri: string,
): CodeLens {
  const { compileResult, name } = comp;

  if (compileResult.status === 'success') {
    const statusLabel = 'Optimized';
    return CodeLens.create(range, {
      title: `${kindLabel} · ${statusLabel}`,
      command: 'reactCompilerLens.peekCompiled',
      arguments: [uri, name],
    });
  }

  if (compileResult.status === 'error') {
    const count = compileResult.diagnostics.length;
    const statusLabel =
      count === 0
        ? 'Not Optimized'
        : `Not Optimized (${count} ${count === 1 ? 'error' : 'errors'})`;
    return CodeLens.create(range, {
      title: `${kindLabel} · ${statusLabel}`,
      command: 'workbench.actions.view.problems',
      arguments: [],
    });
  }

  // skip
  const statusLabel = `Skipped: "${compileResult.reason}"`;
  return CodeLens.create(range, {
    title: `${kindLabel} · ${statusLabel}`,
    command: '',
    arguments: [],
  });
}

// -------------------------------------------------------------------
// Start
// -------------------------------------------------------------------

documents.listen(connection);
connection.listen();
