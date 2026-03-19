import type * as t from '@babel/types';
import type { Framework, FileAnalysisResult, DeclaredComponentAnalysis, ImportedComponentAnalysis, CompileResult, DiagnosticInfo } from '@react-compiler-lens/shared';
import { parseCode, walkAst, isComponentName } from './ast';
import { compileFile, type CapturedEvent } from './compiler';
import { extractFileDirective, extractFunctionDirectives } from './directives';
import { ImportResolver } from './resolution';

export interface AnalyzerOptions {
  framework: Framework;
  importResolver?: ImportResolver;
}

interface ImportInfo {
  name: string;
  specifier: string;
  importLocation: { line: number; column: number };
}

interface JsxUsageMap {
  [name: string]: { line: number; column: number }[];
}

export class Analyzer {
  private framework: Framework;
  private importResolver: ImportResolver;

  constructor(options: AnalyzerOptions) {
    this.framework = options.framework;
    this.importResolver = options.importResolver ?? new ImportResolver();
  }

  async analyze(filePath: string, code: string): Promise<FileAnalysisResult> {
    // Step 1: Run the React Compiler to get events and compiled output
    const { events, compiledCode, getComponentEvents } = await compileFile(code, filePath);

    // Step 2: Extract directives (file-level and function-level)
    const fileDirective = extractFileDirective(code);
    const functionDirectives = extractFunctionDirectives(code);

    // Step 3: Parse the file with @babel/parser for import/JSX analysis
    const ast = this.parseAst(code);

    // Step 4: Build declared components from compiler events
    const declaredComponents = this.buildDeclaredComponents(
      getComponentEvents(),
      fileDirective,
      functionDirectives,
    );

    // Step 5: Build imported components with resolved directives and JSX locations
    const importedComponents = ast
      ? this.buildImportedComponents(filePath, ast, code)
      : [];

    // Step 6: Collect CompileDiagnostic events as informational diagnostics
    const compilerDiagnostics = this.collectCompilerDiagnostics(events);

    return {
      filePath,
      directive: fileDirective,
      framework: this.framework,
      declaredComponents,
      importedComponents,
      compiledCode,
      compilerDiagnostics,
    };
  }

  // --- Private helpers ---

  private parseAst(code: string) {
    return parseCode(code);
  }

  private buildDeclaredComponents(
    componentEvents: CapturedEvent[],
    fileDirective: ReturnType<typeof extractFileDirective>,
    functionDirectives: ReturnType<typeof extractFunctionDirectives>,
  ): DeclaredComponentAnalysis[] {
    // Group events by fnName
    const grouped = new Map<string, CapturedEvent[]>();
    for (const event of componentEvents) {
      if (!event.fnName) continue;
      const existing = grouped.get(event.fnName) ?? [];
      existing.push(event);
      grouped.set(event.fnName, existing);
    }

    const results: DeclaredComponentAnalysis[] = [];
    for (const [name, events] of grouped) {
      const location = this.resolveComponentLocation(events);
      const directive = functionDirectives.get(name) ?? fileDirective;
      const compileResult = this.buildCompileResult(name, events);
      results.push({ name, location, directive, compileResult });
    }
    return results;
  }

  private resolveComponentLocation(events: CapturedEvent[]): { line: number; column: number } {
    for (const event of events) {
      if (event.fnLoc) {
        return { line: event.fnLoc.start.line, column: event.fnLoc.start.column };
      }
    }
    return { line: 1, column: 0 };
  }

  private buildCompileResult(name: string, events: CapturedEvent[]): CompileResult {
    const successEvent = events.find(e => e.kind === 'CompileSuccess');
    if (successEvent) {
      const raw = successEvent.raw as {
        kind: 'CompileSuccess';
        memoSlots: number;
        memoBlocks: number;
        memoValues: number;
        prunedMemoBlocks: number;
        prunedMemoValues: number;
        fnName: string | null;
      };
      return {
        status: 'success',
        memoSlots: raw.memoSlots,
        memoBlocks: raw.memoBlocks,
        memoValues: raw.memoValues,
        prunedMemoBlocks: raw.prunedMemoBlocks,
        prunedMemoValues: raw.prunedMemoValues,
      };
    }

    const skipEvent = events.find(e => e.kind === 'CompileSkip');
    if (skipEvent) {
      const raw = skipEvent.raw as { kind: 'CompileSkip'; reason: string };
      return { status: 'skip', reason: cleanSkipReason(raw.reason) };
    }

    const errorEvents = events.filter(e =>
      e.kind === 'CompileError' || e.kind === 'PipelineError' || e.kind === 'CompileUnexpectedThrow'
    );
    if (errorEvents.length > 0) {
      const diagnostics = errorEvents.flatMap(e => this.normalizeDiagnostic(e));
      return { status: 'error', diagnostics };
    }

    return { status: 'error', diagnostics: [] };
  }

  private normalizeDiagnostic(event: CapturedEvent): DiagnosticInfo[] {
    if (event.kind === 'CompileError') {
      const raw = event.raw as { kind: 'CompileError'; detail: unknown };
      const detail = raw.detail as {
        reason?: string;
        loc?: { start?: { line?: number; column?: number } } | null;
        primaryLocation?: () => { start?: { line?: number; column?: number } } | null;
      };

      const message = typeof detail.reason === 'string' ? detail.reason : String(detail);
      let line: number | null = null;
      let column: number | null = null;

      // CompilerErrorDetail has .loc; CompilerDiagnostic has .primaryLocation()
      if (detail.loc !== undefined) {
        const loc = detail.loc;
        if (loc && typeof loc === 'object' && 'start' in loc) {
          line = (loc as { start: { line: number; column: number } }).start.line ?? null;
          column = (loc as { start: { line: number; column: number } }).start.column ?? null;
        }
      } else if (typeof detail.primaryLocation === 'function') {
        const loc = detail.primaryLocation();
        if (loc && typeof loc === 'object' && 'start' in loc) {
          line = (loc as { start: { line: number; column: number } }).start.line ?? null;
          column = (loc as { start: { line: number; column: number } }).start.column ?? null;
        }
      }

      return [{ message, line, column, severity: 'error' }];
    }

    if (event.kind === 'PipelineError') {
      const raw = event.raw as { kind: 'PipelineError'; data: string };
      return [{ message: raw.data, line: null, column: null, severity: 'error' }];
    }

    if (event.kind === 'CompileUnexpectedThrow') {
      const raw = event.raw as unknown as { kind: 'CompileUnexpectedThrow'; unexpectedError: unknown };
      const err = raw.unexpectedError;
      const message =
        err instanceof Error ? err.message : typeof err === 'string' ? err : 'Unexpected error during compilation';
      return [{ message, line: null, column: null, severity: 'error' }];
    }

    return [];
  }

  private collectCompilerDiagnostics(events: CapturedEvent[]): DiagnosticInfo[] {
    return events
      .filter(e => e.kind === 'CompileDiagnostic')
      .map(e => {
        const raw = e.raw as { kind: 'CompileDiagnostic'; detail: unknown };
        const detail = raw.detail as {
          reason?: string;
          loc?: { start?: { line?: number; column?: number } } | null;
        };
        return {
          message: typeof detail.reason === 'string' ? detail.reason : String(detail),
          line: detail.loc?.start?.line ?? e.fnLoc?.start.line ?? null,
          column: detail.loc?.start?.column ?? e.fnLoc?.start.column ?? null,
          severity: 'info' as const,
        };
      });
  }

  private buildImportedComponents(
    filePath: string,
    ast: ReturnType<typeof parseCode> & object,
    code: string,
  ): ImportedComponentAnalysis[] {
    const imports = this.collectPascalCaseImports(ast);
    const jsxUsage = this.collectJsxTagLocations(ast, new Set(imports.map(i => i.name)));

    return imports.map(imp => {
      const directive = this.importResolver.resolveImportDirective(filePath, imp.specifier, imp.name);
      const sourceFilePath = this.importResolver.resolveModulePath(filePath, imp.specifier) ?? '';
      return {
        name: imp.name,
        importLocation: imp.importLocation,
        jsxLocations: jsxUsage[imp.name] ?? [],
        directive,
        sourceFilePath,
      };
    });
  }

  private collectPascalCaseImports(ast: ReturnType<typeof parseCode> & object): ImportInfo[] {
    const imports: ImportInfo[] = [];

    for (const node of ast.program.body) {
      if (node.type !== 'ImportDeclaration') continue;
      const specifier = node.source.value;

      for (const spec of node.specifiers) {
        // Skip namespace imports (import * as Foo) — not a component itself
        if (spec.type === 'ImportNamespaceSpecifier') continue;

        const name = spec.local.name;
        if (!isComponentName(name)) continue;

        const loc = spec.loc ?? node.loc;
        imports.push({
          name,
          specifier,
          importLocation: {
            line: loc?.start.line ?? 1,
            column: loc?.start.column ?? 0,
          },
        });
      }
    }

    return imports;
  }

  private collectJsxTagLocations(
    ast: ReturnType<typeof parseCode> & object,
    componentNames: Set<string>,
  ): JsxUsageMap {
    const usage: JsxUsageMap = {};

    walkAst(ast.program as unknown as t.Node, node => {
      if (node.type !== 'JSXOpeningElement') return;
      const jsxNode = node as t.JSXOpeningElement;

      let name: string | null = null;
      if (jsxNode.name.type === 'JSXIdentifier') {
        name = jsxNode.name.name;
      } else if (jsxNode.name.type === 'JSXMemberExpression') {
        // e.g. Foo.Bar — use the root object name
        let obj = jsxNode.name.object;
        while (obj.type === 'JSXMemberExpression') obj = obj.object;
        name = obj.name;
      }

      if (!name || !componentNames.has(name)) return;

      const loc = jsxNode.name.loc ?? jsxNode.loc;
      const entry = { line: loc?.start.line ?? 1, column: loc?.start.column ?? 0 };
      if (!usage[name]) usage[name] = [];
      usage[name].push(entry);
    });

    return usage;
  }
}

// --- Module-level helpers ---

/**
 * Clean up skip reason from React Compiler.
 * The compiler may stringify directive AST nodes as [object Object].
 */
function cleanSkipReason(reason: string): string {
  if (reason.includes('[object Object]')) {
    // Extract the directive pattern — common: "Skipped due to '...' directive"
    if (reason.toLowerCase().includes('directive')) {
      return 'use no memo';
    }
    return 'opt-out directive';
  }
  // Strip trailing period for cleaner display
  return reason.replace(/\.$/, '');
}

