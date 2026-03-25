import * as crypto from 'node:crypto';
import { TextDocument } from 'vscode-languageserver-textdocument';
import {
  CodeLens,
  createConnection,
  Diagnostic,
  DiagnosticSeverity,
  type InitializeParams,
  type InitializeResult,
  ProposedFeatures,
  Range,
  TextDocuments,
  TextDocumentSyncKind,
} from 'vscode-languageserver/node';
import { Analyzer, getDeclaredComponentLabel } from './analyzer';
import { detectFramework } from './framework';
import type {
  FileAnalysisResult,
  DeclaredComponentAnalysis,
  Directive,
  Framework,
  FileKind,
} from '@react-compiler-lens/shared';

interface Config {
  enabled: boolean;
  serverComponent: boolean;
  clientComponent: boolean;
  compilationStatus: boolean;
  serverAction: boolean;
  serverOnly: boolean;
  showDefaultSuffix: boolean;
  reactiveValues: boolean;
  reactiveValuesMaxDisplay: number;
  importedComponentJsxLens: boolean;
  showInheritedSuffix: boolean;
  diagnosticsEnabled: boolean;
  diagnosticsSeverity: string;
  showDescription: boolean;
  showRelatedLocations: boolean;
  framework: string;
}

const defaultConfig: Config = {
  enabled: true,
  serverComponent: true,
  clientComponent: true,
  compilationStatus: true,
  serverAction: true,
  serverOnly: true,
  showDefaultSuffix: true,
  reactiveValues: true,
  reactiveValuesMaxDisplay: 3,
  importedComponentJsxLens: true,
  showInheritedSuffix: true,
  diagnosticsEnabled: true,
  diagnosticsSeverity: 'warning',
  showDescription: true,
  showRelatedLocations: true,
  framework: 'auto',
};

const connection = createConnection(ProposedFeatures.all);
const documents = new TextDocuments(TextDocument);

let analyzer: Analyzer | null = null;
let workspaceRoot: string | null = null;
let config: Config = { ...defaultConfig };
let hasCodeLensRefresh = false;

const analysisCache = new Map<string, FileAnalysisResult>();
const contentHashCache = new Map<string, string>();
const debounceTimers = new Map<string, ReturnType<typeof setTimeout>>();

const DEBOUNCE_MS = 200;

function md5(content: string): string {
  return crypto.createHash('md5').update(content).digest('hex');
}

function getKindLabel(directive: Directive): string | null {
  if (directive === 'use client') return 'Client Component';
  if (directive === 'use server') return 'Server Action';
  return null;
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

function shouldShowDeclaredComponent(
  compDirective: Directive,
  fileKind: FileKind,
  cfg: Config,
): boolean {
  if (compDirective === 'use client' && !cfg.clientComponent) return false;
  if (compDirective === 'use server' && !cfg.serverComponent) return false;
  if (compDirective === null) {
    if (fileKind === 'server-default' && !cfg.serverComponent) return false;
    if (fileKind === 'server-only' && !cfg.serverOnly) return false;
  }
  return true;
}

function createLabelOnlyLens(line: number, col: number, label: string): CodeLens {
  const range = Range.create(line, col, line, col);
  const lens = CodeLens.create(range);
  lens.command = { title: label, command: '' };
  return lens;
}

connection.onInitialize((params: InitializeParams): InitializeResult => {
  hasCodeLensRefresh = !!params.capabilities.workspace?.codeLens?.refreshSupport;

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

connection.onDidChangeConfiguration(change => {
  const s = (change.settings as { reactCompilerLens?: Record<string, any> })?.reactCompilerLens;
  if (!s) return;

  const codeLens = s['codeLens'] as Record<string, unknown> | undefined;
  const diagnostics = s['diagnostics'] as Record<string, unknown> | undefined;

  config = {
    enabled: (s['enabled'] as boolean) ?? defaultConfig.enabled,
    serverComponent: (codeLens?.['serverComponent'] as boolean) ?? defaultConfig.serverComponent,
    clientComponent: (codeLens?.['clientComponent'] as boolean) ?? defaultConfig.clientComponent,
    compilationStatus: (codeLens?.['compilationStatus'] as boolean) ?? defaultConfig.compilationStatus,
    serverAction: (codeLens?.['serverAction'] as boolean) ?? defaultConfig.serverAction,
    serverOnly: (codeLens?.['serverOnly'] as boolean) ?? defaultConfig.serverOnly,
    showDefaultSuffix: (codeLens?.['showDefaultSuffix'] as boolean) ?? defaultConfig.showDefaultSuffix,
    reactiveValues: (codeLens?.['reactiveValues'] as boolean) ?? defaultConfig.reactiveValues,
    reactiveValuesMaxDisplay: (codeLens?.['reactiveValuesMaxDisplay'] as number) ?? defaultConfig.reactiveValuesMaxDisplay,
    importedComponentJsxLens: (codeLens?.['importedComponentJsxLens'] as boolean) ?? defaultConfig.importedComponentJsxLens,
    showInheritedSuffix: (codeLens?.['showInheritedSuffix'] as boolean) ?? defaultConfig.showInheritedSuffix,
    diagnosticsEnabled: (diagnostics?.['enabled'] as boolean) ?? defaultConfig.diagnosticsEnabled,
    diagnosticsSeverity: (diagnostics?.['severity'] as string) ?? defaultConfig.diagnosticsSeverity,
    showDescription: (diagnostics?.['showDescription'] as boolean) ?? defaultConfig.showDescription,
    showRelatedLocations: (diagnostics?.['showRelatedLocations'] as boolean) ?? defaultConfig.showRelatedLocations,
    framework: (s['framework'] as string) ?? defaultConfig.framework,
  };

  if (config.framework !== 'auto') {
    analyzer = new Analyzer({ framework: config.framework as Framework });
  } else if (workspaceRoot) {
    analyzer = new Analyzer({ framework: detectFramework(workspaceRoot) });
  }

  for (const doc of documents.all()) {
    scheduleAnalysis(doc);
  }
});

documents.onDidChangeContent(change => {
  scheduleAnalysis(change.document);
});

documents.onDidClose(event => {
  const uri = event.document.uri;

  const timer = debounceTimers.get(uri);
  if (timer !== undefined) {
    clearTimeout(timer);
    debounceTimers.delete(uri);
  }

  analysisCache.delete(uri);
  contentHashCache.delete(uri);
  connection.sendDiagnostics({ uri, diagnostics: [] });
});

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

  if (contentHashCache.get(uri) === hash) return;
  contentHashCache.set(uri, hash);

  let filePath: string;
  try {
    filePath = new URL(uri).pathname;
  } catch {
    filePath = uri;
  }

  let result: FileAnalysisResult;
  try {
    result = await analyzer.analyze(filePath, content);
  } catch (err) {
    connection.console.error(`Analysis failed for ${uri}: ${err instanceof Error ? err.message : String(err)}`);
    return;
  }

  analysisCache.set(uri, result);

  if (config.diagnosticsEnabled) {
    publishDiagnostics(uri, result);
  } else {
    connection.sendDiagnostics({ uri, diagnostics: [] });
  }

  if (hasCodeLensRefresh) {
    connection.sendRequest('workspace/codeLens/refresh');
  }
}

function publishDiagnostics(uri: string, result: FileAnalysisResult): void {
  const diagnostics: Diagnostic[] = [];
  const severity = mapSeverity(config.diagnosticsSeverity);

  for (const comp of result.declaredComponents) {
    if (comp.compileResult.status !== 'error') continue;

    for (const info of comp.compileResult.diagnostics) {
      const line = info.line !== null ? info.line - 1 : Math.max(0, comp.location.line - 1);
      const col = info.column !== null ? info.column : comp.location.column;

      const categoryPrefix = info.category ? `[${info.category}] ` : '';
      let message = `${categoryPrefix}[${comp.name}] ${info.message}`;
      if (config.showDescription && info.description) {
        message += `\n${info.description}`;
      }
      if (info.details) {
        const hints = info.details.filter(d => d.kind === 'hint');
        if (hints.length > 0) {
          message += '\n' + hints.map(h => `Hint: ${h.message}`).join('\n');
        }
      }

      const diag: Diagnostic = {
        range: Range.create(line, col, line, col + 1),
        severity,
        source: 'react-compiler',
        message,
      };

      // Add related locations (e.g., freeze point + mutation point)
      if (config.showRelatedLocations && info.details) {
        const errorLocs = info.details.filter(d => d.kind === 'error' && d.line != null);
        if (errorLocs.length > 0) {
          diag.relatedInformation = errorLocs.map(d => ({
            location: {
              uri,
              range: Range.create(
                Math.max(0, d.line! - 1), d.column ?? 0,
                Math.max(0, d.line! - 1), (d.column ?? 0) + 1,
              ),
            },
            message: d.message,
          }));
        }
      }

      diagnostics.push(diag);
    }
  }

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

connection.onRequest(
  'react-compiler-lens/getCompiledCode',
  (params: { uri: string }): { code: string | null } => {
    const result = analysisCache.get(params.uri);
    return { code: result?.compiledCode ?? null };
  },
);

connection.onRequest('react-compiler-lens/refresh', () => {
  analysisCache.clear();
  contentHashCache.clear();
  for (const doc of documents.all()) {
    scheduleAnalysis(doc);
  }
  return { ok: true };
});

connection.onCodeLens(params => {
  const uri = params.textDocument.uri;
  const result = analysisCache.get(uri);

  if (!result || !config.enabled) return [];

  const lenses: CodeLens[] = [];

  // A. Declared Components
  for (const comp of result.declaredComponents) {
    if (!shouldShowDeclaredComponent(comp.directive, result.fileKind, config)) continue;

    const kindLabel = getDeclaredComponentLabel(
      comp.directive, result.fileKind, config.showDefaultSuffix,
    );
    const line = Math.max(0, comp.location.line - 1);
    const col = comp.location.column;

    if (config.compilationStatus) {
      const range = Range.create(line, col, line, col);
      lenses.push(buildDeclaredComponentLens(comp, kindLabel, range, uri));
    } else if (kindLabel) {
      lenses.push(createLabelOnlyLens(line, col, kindLabel));
    }
  }

  // B. Server Action Exports
  if (config.serverAction && result.fileKind === 'server-action') {
    for (const action of result.serverActionExports) {
      const line = Math.max(0, action.line - 1);
      lenses.push(createLabelOnlyLens(line, 0, 'Server Action'));
    }
  }

  // C. server-only File Indicator (only when no declared components)
  if (config.serverOnly && result.fileKind === 'server-only'
      && result.serverOnlyImportLine !== null
      && result.declaredComponents.length === 0) {
    const line = Math.max(0, result.serverOnlyImportLine - 1);
    lenses.push(createLabelOnlyLens(line, 0, 'server-only'));
  }

  // D. Imported Components
  for (const imp of result.importedComponents) {
    const effectiveDirective = imp.directive ?? imp.inheritedDirective;

    let label: string | null = null;

    if (effectiveDirective) {
      if (effectiveDirective === 'use client' && !config.clientComponent) continue;
      if (effectiveDirective === 'use server' && !config.serverComponent) continue;

      const baseLabel = getKindLabel(effectiveDirective);
      if (!baseLabel) continue;
      label = imp.directive
        ? baseLabel
        : config.showInheritedSuffix ? `${baseLabel} (inherited)` : baseLabel;
    } else if (imp.sourceFileKind === 'server-default' && config.serverComponent) {
      label = config.showDefaultSuffix
        ? 'Server Component (default)' : 'Server Component';
    }

    if (!label) continue;

    lenses.push(createLabelOnlyLens(
      Math.max(0, imp.importLocation.line - 1),
      imp.importLocation.column,
      label,
    ));

    if (config.importedComponentJsxLens) {
      for (const jsxLoc of imp.jsxLocations) {
        lenses.push(createLabelOnlyLens(
          Math.max(0, jsxLoc.line - 1),
          jsxLoc.column,
          label,
        ));
      }
    }
  }

  return lenses;
});

function buildDeclaredComponentLens(
  comp: DeclaredComponentAnalysis,
  kindLabel: string | null,
  range: Range,
  uri: string,
): CodeLens {
  const { compileResult, name } = comp;
  const lens = CodeLens.create(range);
  const prefix = kindLabel ? `${kindLabel} · ` : '';

  const line = Math.max(0, comp.location.line - 1);

  if (compileResult.status === 'success') {
    let title = `${prefix}Optimized`;

    if (config.reactiveValues && compileResult.reactiveValues.length > 0) {
      const maxDisplay = config.reactiveValuesMaxDisplay;
      const names = compileResult.reactiveValues;
      const display = names.length <= maxDisplay
        ? names.join(', ')
        : `${names.slice(0, maxDisplay).join(', ')} +${names.length - maxDisplay}`;
      title += ` · reactive: ${display}`;
    }

    lens.command = {
      title,
      command: 'reactCompilerLens.peekCompiled',
      arguments: [uri, name, line],
    };
  } else if (compileResult.status === 'error') {
    const categories = [...new Set(
      compileResult.diagnostics
        .map(d => d.category)
        .filter((c): c is string => c != null)
    )];
    const MAX_CATEGORIES = 2;
    let statusLabel: string;
    if (categories.length > 0) {
      const display = categories.length <= MAX_CATEGORIES
        ? categories.join(', ')
        : `${categories.slice(0, MAX_CATEGORIES).join(', ')} +${categories.length - MAX_CATEGORIES}`;
      statusLabel = `Not Optimized (${display})`;
    } else {
      const count = compileResult.diagnostics.length;
      statusLabel = count === 0
        ? 'Not Optimized'
        : `Not Optimized (${count} ${count === 1 ? 'error' : 'errors'})`;
    }
    lens.command = {
      title: `${prefix}${statusLabel}`,
      command: 'reactCompilerLens.showProblems',
    };
  } else {
    lens.command = {
      title: `${prefix}Skipped: "${compileResult.reason}"`,
      command: '',
    };
  }

  return lens;
}

documents.listen(connection);
connection.listen();
