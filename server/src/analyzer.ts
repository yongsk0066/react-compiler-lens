import type * as t from '@babel/types';
import type { Framework, FileAnalysisResult, DeclaredComponentAnalysis, ImportedComponentAnalysis, CompileResult, DiagnosticInfo, Directive, FileKind, ServerActionExport } from '@react-compiler-lens/shared';
import { CompilerErrorDetail, CompilerDiagnostic } from 'babel-plugin-react-compiler';
import { parseCode, walkAst } from './ast';
import { compileFile, type CapturedEvent } from './compiler';
import { extractFileDirective, extractFunctionDirectives } from './directives';
import { ImportResolver } from './resolution';

export interface AnalyzerOptions {
  framework: Framework;
  workspaceRoot?: string;
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
    if (options.workspaceRoot) {
      this.importResolver.setWorkspaceRoot(options.workspaceRoot);
    }
  }

  invalidateFile(filePath: string): void {
    this.importResolver.invalidate(filePath);
  }

  async analyze(filePath: string, code: string): Promise<FileAnalysisResult> {
    const compileResult = await compileFile(code, filePath);
    const { events, compiledCode, getComponentEvents } = compileResult;

    const ast = compileResult.ast ?? parseCode(code);
    const fileDirective = extractFileDirective(code, ast ?? undefined);
    const functionDirectives = extractFunctionDirectives(code, ast ?? undefined);

    const serverOnlyImportLine = ast ? detectServerOnlyImportLine(ast) : null;
    const fileKind = determineFileKind(fileDirective, serverOnlyImportLine !== null, this.framework);

    // Compute reactive values from compiled output (local to avoid data race)
    const reactiveValuesMap = compiledCode ? buildReactiveValuesMap(compiledCode) : new Map<string, string[]>();

    const declaredComponents = this.buildDeclaredComponents(
      getComponentEvents(),
      fileDirective,
      functionDirectives,
      reactiveValuesMap,
    );

    const serverActionExports = fileKind === 'server-action' && ast
      ? extractServerActionExports(ast)
      : [];

    const importedComponents = ast
      ? this.buildImportedComponents(filePath, ast, code, fileDirective)
      : [];

    const compilerDiagnostics = this.collectCompilerDiagnostics(events);

    return {
      filePath,
      fileKind,
      directive: fileDirective,
      framework: this.framework,
      declaredComponents,
      serverActionExports,
      importedComponents,
      compiledCode,
      compilerDiagnostics,
      serverOnlyImportLine,
    };
  }

  private buildDeclaredComponents(
    componentEvents: CapturedEvent[],
    fileDirective: ReturnType<typeof extractFileDirective>,
    functionDirectives: ReturnType<typeof extractFunctionDirectives>,
    reactiveValuesMap: Map<string, string[]>,
  ): DeclaredComponentAnalysis[] {
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
      const compileResult = this.buildCompileResult(name, events, reactiveValuesMap);
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

  private buildCompileResult(name: string, events: CapturedEvent[], reactiveValuesMap: Map<string, string[]>): CompileResult {
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
        reactiveValues: reactiveValuesMap.get(name) ?? [],
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
      const detail = raw.detail;

      if (isCompilerDiagnostic(detail)) {
        return [this.extractFromCompilerDiagnostic(detail)];
      }
      if (isCompilerErrorDetail(detail)) {
        return [this.extractFromErrorDetail(detail)];
      }
      // Fallback for unknown detail structures
      const msg = detail && typeof detail === 'object' && 'reason' in detail
        ? String((detail as { reason?: unknown }).reason)
        : String(detail);
      return [{ message: msg, line: null, column: null, severity: 'error' }];
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

  private extractFromCompilerDiagnostic(diag: InstanceType<typeof CompilerDiagnostic>): DiagnosticInfo {
    type DiagDetail = { kind: string; loc?: unknown; message?: string | null };

    const loc = safeGetLocation(diag.primaryLocation());
    const errorDetails = diag.options.details.filter(
      (d: DiagDetail) => d.kind === 'error' && d.loc && typeof d.loc !== 'symbol'
    );
    const hintDetails = diag.options.details.filter(
      (d: DiagDetail) => d.kind === 'hint'
    );

    return {
      message: diag.reason,
      line: loc?.line ?? null,
      column: loc?.column ?? null,
      severity: mapCompilerSeverity(diag.severity),
      category: diag.category,
      description: diag.description,
      details: [
        ...errorDetails.map((d: DiagDetail) => ({
          kind: 'error' as const,
          line: safeGetLocation(d.loc)?.line,
          column: safeGetLocation(d.loc)?.column,
          message: d.message ?? '',
        })),
        ...hintDetails.map((d: DiagDetail) => ({
          kind: 'hint' as const,
          message: d.message ?? '',
        })),
      ],
    };
  }

  private extractFromErrorDetail(detail: InstanceType<typeof CompilerErrorDetail>): DiagnosticInfo {
    const loc = safeGetLocation(detail.primaryLocation());
    return {
      message: detail.reason,
      line: loc?.line ?? null,
      column: loc?.column ?? null,
      severity: mapCompilerSeverity(detail.severity),
      category: detail.category,
      description: detail.description ?? null,
    };
  }

  private collectCompilerDiagnostics(events: CapturedEvent[]): DiagnosticInfo[] {
    return events
      .filter(e => e.kind === 'CompileDiagnostic')
      .map(e => {
        const raw = e.raw as { kind: 'CompileDiagnostic'; detail: unknown };
        const detail = raw.detail;
        if (isCompilerDiagnostic(detail)) {
          const enriched = this.extractFromCompilerDiagnostic(detail);
          return { ...enriched, severity: 'info' as const };
        }
        if (isCompilerErrorDetail(detail)) {
          const enriched = this.extractFromErrorDetail(detail);
          return { ...enriched, severity: 'info' as const };
        }
        const d = detail as { reason?: string; loc?: unknown };
        const loc = safeGetLocation(d?.loc);
        return {
          message: typeof d?.reason === 'string' ? d.reason : String(d),
          line: loc?.line ?? e.fnLoc?.start.line ?? null,
          column: loc?.column ?? e.fnLoc?.start.column ?? null,
          severity: 'info' as const,
        };
      });
  }

  private buildImportedComponents(
    filePath: string,
    ast: ReturnType<typeof parseCode> & object,
    code: string,
    fileDirective: Directive,
  ): ImportedComponentAnalysis[] {
    const imports = this.collectImportCandidates(ast);
    const resolved = new Map<string, { directive: Directive; resolvedPath: string }>();

    for (const imp of imports) {
      const result = this.importResolver.resolveImportWithPath(filePath, imp.specifier, imp.name);
      if (result.resolvedPath && result.isComponent) {
        resolved.set(imp.name, { directive: result.directive, resolvedPath: result.resolvedPath });
      }
    }

    const jsxUsage = this.collectJsxTagLocations(ast, new Set(resolved.keys()));

    return imports
      .filter(imp => resolved.has(imp.name))
      .map(imp => {
        const { directive, resolvedPath } = resolved.get(imp.name)!;
        return {
          name: imp.name,
          importLocation: imp.importLocation,
          jsxLocations: jsxUsage[imp.name] ?? [],
          directive,
          inheritedDirective: directive === null ? fileDirective : null,
          sourceFilePath: resolvedPath,
          sourceFileKind: deriveSourceFileKind(directive, this.framework),
        };
      });
  }

  private collectImportCandidates(ast: ReturnType<typeof parseCode> & object): ImportInfo[] {
    const imports: ImportInfo[] = [];

    for (const node of ast.program.body) {
      if (node.type !== 'ImportDeclaration') continue;
      const specifier = node.source.value;

      for (const spec of node.specifiers) {
        if (spec.type === 'ImportNamespaceSpecifier') continue;

        const name = spec.local.name;
        if (!isPascalCaseComponentName(name)) continue;

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

/** Safe location extraction — handles null, symbol (GeneratedSource), and normal SourceLocation */
function safeGetLocation(loc: unknown): { line: number; column: number } | null {
  if (!loc || typeof loc === 'symbol' || typeof loc !== 'object') return null;
  const l = loc as { start?: { line?: number; column?: number } };
  if (typeof l.start?.line !== 'number') return null;
  return { line: l.start.line, column: l.start.column ?? 0 };
}

/** Map React Compiler's ErrorSeverity to our severity strings */
function mapCompilerSeverity(severity: string): 'error' | 'warning' | 'info' {
  switch (severity) {
    case 'Error': return 'error';
    case 'Warning': return 'warning';
    default: return 'info';
  }
}

/** Type guard: is the detail a CompilerDiagnostic instance? */
function isCompilerDiagnostic(detail: unknown): detail is CompilerDiagnostic {
  if (detail instanceof CompilerDiagnostic) return true;
  // Duck typing fallback
  if (detail === null || typeof detail !== 'object' || !('options' in detail)) return false;
  const obj = detail as Record<string, unknown>;
  if (typeof obj.options !== 'object' || obj.options === null) return false;
  const opts = obj.options as Record<string, unknown>;
  return 'details' in opts && Array.isArray(opts.details);
}

/** Type guard: is the detail a CompilerErrorDetail instance? */
function isCompilerErrorDetail(detail: unknown): detail is CompilerErrorDetail {
  if (detail instanceof CompilerErrorDetail) return true;
  // Duck typing fallback
  if (detail === null || typeof detail !== 'object') return false;
  const obj = detail as Record<string, unknown>;
  return 'category' in obj && 'reason' in obj
    && typeof obj.reason === 'string'
    && !('options' in obj);
}

// ── Reactive values extraction (compiled output parsing) ──

/** Extract per-function reactive dependencies from compiled React Compiler output. */
function buildReactiveValuesMap(compiledCode: string): Map<string, string[]> {
  let ast: ReturnType<typeof parseCode>;
  try {
    ast = parseCode(compiledCode);
  } catch {
    return new Map();
  }
  if (!ast) return new Map();

  const result = new Map<string, string[]>();

  for (const node of ast.program.body) {
    const fn = toNamedFunction(node);
    if (!fn) continue;
    const deps = findCacheDeps(fn.body);
    if (deps.length > 0) result.set(fn.name, deps);
  }

  return result;
}

/** Extract {name, body} from various function declaration patterns in compiled output. */
function toNamedFunction(node: t.Statement): { name: string; body: t.BlockStatement } | null {
  // function Foo() {}
  if (node.type === 'FunctionDeclaration' && node.id?.name) {
    return { name: node.id.name, body: node.body };
  }
  // export default function Foo() {}
  if (node.type === 'ExportDefaultDeclaration') {
    const decl = node.declaration;
    if (decl.type === 'FunctionDeclaration' && decl.id?.name) {
      return { name: decl.id.name, body: decl.body };
    }
  }
  // export function Foo() {} OR export const Foo = () => {}
  if (node.type === 'ExportNamedDeclaration' && node.declaration) {
    if (node.declaration.type === 'FunctionDeclaration' && node.declaration.id?.name) {
      return { name: node.declaration.id.name, body: node.declaration.body };
    }
    if (node.declaration.type === 'VariableDeclaration') {
      for (const decl of node.declaration.declarations) {
        if (decl.id?.type === 'Identifier' && decl.init) {
          if (decl.init.type === 'ArrowFunctionExpression' && decl.init.body?.type === 'BlockStatement') {
            return { name: decl.id.name, body: decl.init.body };
          }
          if (decl.init.type === 'FunctionExpression') {
            return { name: decl.id.name, body: decl.init.body };
          }
        }
      }
    }
  }
  // const Foo = () => {} (non-exported)
  if (node.type === 'VariableDeclaration') {
    for (const decl of node.declarations) {
      if (decl.id?.type === 'Identifier' && decl.init) {
        if (decl.init.type === 'ArrowFunctionExpression' && decl.init.body?.type === 'BlockStatement') {
          return { name: decl.id.name, body: decl.init.body };
        }
        if (decl.init.type === 'FunctionExpression') {
          return { name: decl.id.name, body: decl.init.body };
        }
      }
    }
  }
  return null;
}

/** Find cache dependency identifiers from $[N] !== dep patterns in a function body. */
function findCacheDeps(body: any): string[] {
  const deps: string[] = [];
  walkAst(body as unknown as t.Node, node => {
    if (node.type !== 'BinaryExpression') return;
    const bin = node as t.BinaryExpression;
    if (bin.operator !== '!==') return;
    if (!isCacheSlot(bin.left)) return;
    const name = toDepString(bin.right);
    if (name && name !== '$' && !deps.includes(name)) {
      deps.push(name);
    }
  });
  return deps;
}

/** Check if an AST node is a cache slot access: $[N] */
function isCacheSlot(node: t.Node): boolean {
  if (node.type !== 'MemberExpression') return false;
  const m = node as t.MemberExpression;
  return m.object.type === 'Identifier'
    && (m.object as t.Identifier).name === '$'
    && m.computed
    && m.property.type === 'NumericLiteral';
}

/** Convert AST expression to readable dependency string. */
function toDepString(node: t.Node): string | null {
  if (node.type === 'Identifier') return (node as t.Identifier).name;
  if (node.type === 'MemberExpression' && !(node as t.MemberExpression).computed) {
    const obj = toDepString((node as t.MemberExpression).object as t.Node);
    const prop = ((node as t.MemberExpression).property as t.Identifier).name;
    return obj ? `${obj}.${prop}` : null;
  }
  if (node.type === 'OptionalMemberExpression') {
    interface OptionalMemberExpr { type: 'OptionalMemberExpression'; computed: boolean; object: t.Node; property: t.Node }
    const optNode = node as unknown as OptionalMemberExpr;
    if (optNode.computed) return null;
    const obj = toDepString(optNode.object);
    const prop = (optNode.property as t.Identifier).name;
    return obj ? `${obj}?.${prop}` : null;
  }
  return null;
}

function cleanSkipReason(reason: string): string {
  if (reason.includes('[object Object]')) {
    if (reason.toLowerCase().includes('directive')) {
      return 'use no memo';
    }
    return 'opt-out directive';
  }
  return reason.replace(/\.$/, '');
}

/** Detect `import 'server-only'` and return its line number, or null. ESM import only. */
export function detectServerOnlyImportLine(ast: t.File): number | null {
  for (const node of ast.program.body) {
    if (node.type === 'ImportDeclaration' && node.source.value === 'server-only') {
      return node.loc?.start.line ?? 1;
    }
  }
  return null;
}

/** Extract exported function/variable names from a 'use server' file. */
export function extractServerActionExports(ast: t.File): ServerActionExport[] {
  const actions: ServerActionExport[] = [];

  for (const node of ast.program.body) {
    if (node.type === 'ExportNamedDeclaration') {
      if (node.declaration?.type === 'FunctionDeclaration' && node.declaration.id) {
        actions.push({
          name: node.declaration.id.name,
          line: node.declaration.loc?.start.line ?? 1,
        });
      }
      if (node.declaration?.type === 'VariableDeclaration') {
        for (const decl of node.declaration.declarations) {
          if (decl.id.type === 'Identifier') {
            actions.push({
              name: decl.id.name,
              line: decl.loc?.start.line ?? 1,
            });
          }
        }
      }
      for (const spec of node.specifiers) {
        if (spec.type === 'ExportSpecifier') {
          const name = spec.exported.type === 'Identifier'
            ? spec.exported.name : (spec.exported as t.StringLiteral).value;
          actions.push({ name, line: spec.loc?.start.line ?? 1 });
        }
      }
    }
    if (node.type === 'ExportDefaultDeclaration') {
      const decl = node.declaration;
      actions.push({
        name: decl.type === 'FunctionDeclaration' && decl.id ? decl.id.name : 'default',
        line: decl.loc?.start.line ?? 1,
      });
    }
  }

  return actions;
}

/** Determine the kind of file based on directive, server-only import, and framework. */
export function determineFileKind(
  fileDirective: Directive,
  hasServerOnlyImport: boolean,
  framework: Framework,
): FileKind {
  if (fileDirective === 'use client') return 'client';
  if (fileDirective === 'use server') return 'server-action';
  if (hasServerOnlyImport) return 'server-only';
  if (framework === 'nextjs') return 'server-default';
  return 'unknown';
}

/** Label for a declared component based on its directive and the file kind. */
export function getDeclaredComponentLabel(
  compDirective: Directive,
  fileKind: FileKind,
  showDefaultSuffix: boolean,
): string | null {
  if (compDirective === 'use client') return 'Client Component';
  if (compDirective === 'use server') return 'Server Action';
  if (fileKind === 'server-default') {
    return showDefaultSuffix ? 'Server Component (default)' : 'Server Component';
  }
  if (fileKind === 'server-only') return 'server-only';
  return null;
}

/** Derive the FileKind of a source file from its resolved directive. */
export function deriveSourceFileKind(sourceDirective: Directive, framework: Framework): FileKind {
  if (sourceDirective === 'use client') return 'client';
  if (sourceDirective === 'use server') return 'server-action';
  if (framework === 'nextjs') return 'server-default';
  return 'unknown';
}

/** Simple PascalCase check for filtering imported component names. */
function isPascalCaseComponentName(name: string): boolean {
  if (/^use[A-Z0-9]/.test(name)) return false;
  return /^[A-Z]/.test(name);
}
