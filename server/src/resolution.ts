import * as fs from 'node:fs';
import * as path from 'node:path';
import * as ts from 'typescript';
import * as parser from '@babel/parser';
import { extractFileDirective } from './directives';
import { classifyFunctions, type ReactFunctionType } from './classify';
import { parseCode } from './ast';
import type { Directive } from '@react-compiler-lens/shared';

const DEFAULT_COMPILER_OPTIONS: ts.CompilerOptions = {
  target: ts.ScriptTarget.ESNext,
  module: ts.ModuleKind.ESNext,
  moduleResolution: ts.ModuleResolutionKind.Bundler,
  jsx: ts.JsxEmit.ReactJSX,
  allowJs: true,
};

function loadCompilerOptions(dir: string): ts.CompilerOptions {
  const configPath = ts.findConfigFile(dir, ts.sys.fileExists, 'tsconfig.json');
  if (!configPath) {
    return DEFAULT_COMPILER_OPTIONS;
  }

  const configFile = ts.readConfigFile(configPath, ts.sys.readFile);
  if (configFile.error) {
    return DEFAULT_COMPILER_OPTIONS;
  }

  const parsed = ts.parseJsonConfigFileContent(
    configFile.config,
    ts.sys,
    path.dirname(configPath),
  );

  if (parsed.errors.length > 0) {
    return DEFAULT_COMPILER_OPTIONS;
  }

  return { ...DEFAULT_COMPILER_OPTIONS, ...parsed.options };
}

interface FileAnalysis {
  directive: Directive;
  components: Map<string, ReactFunctionType>;
}

export class ImportResolver {
  private workspaceRoot: string | null = null;
  private fileCache = new Map<string, FileAnalysis>();
  private reExportCache = new Map<string, Directive>();
  private compilerOptionsCache = new Map<string, ts.CompilerOptions>();

  setWorkspaceRoot(root: string): void {
    this.workspaceRoot = root;
  }

  private cacheSet(key: string, value: FileAnalysis): void {
    if (this.fileCache.size >= 500 && !this.fileCache.has(key)) {
      const oldest = this.fileCache.keys().next().value!;
      this.fileCache.delete(oldest);
    }
    this.fileCache.set(key, value);
  }

  private getCompilerOptions(dir: string): ts.CompilerOptions {
    if (this.compilerOptionsCache.has(dir)) {
      return this.compilerOptionsCache.get(dir)!;
    }
    const options = loadCompilerOptions(dir);
    this.compilerOptionsCache.set(dir, options);
    return options;
  }

  public resolveModulePath(fromFile: string, specifier: string): string | null {
    const dir = path.dirname(fromFile);
    const compilerOptions = this.getCompilerOptions(dir);

    const result = ts.resolveModuleName(
      specifier,
      fromFile,
      compilerOptions,
      ts.sys,
    );

    const resolved = result.resolvedModule?.resolvedFileName ?? null;
    if (resolved && resolved.includes('/node_modules/')) return null;
    if (this.workspaceRoot && resolved) {
      const normalized = path.resolve(resolved);
      if (!normalized.startsWith(this.workspaceRoot + path.sep) && !normalized.startsWith(this.workspaceRoot + '/')) {
        return null;
      }
    }
    return resolved;
  }

  public getFileAnalysis(filePath: string): FileAnalysis {
    if (this.fileCache.has(filePath)) {
      return this.fileCache.get(filePath)!;
    }

    let directive: Directive = null;
    let components = new Map<string, ReactFunctionType>();
    try {
      const code = fs.readFileSync(filePath, 'utf-8');
      const ast = parseCode(code);
      if (ast) {
        directive = extractFileDirective(code, ast);
        components = classifyFunctions(ast);
      }
    } catch {
      // Parse failure
    }

    const result = { directive, components };
    this.cacheSet(filePath, result);
    return result;
  }

  public getDirective(filePath: string): Directive {
    return this.getFileAnalysis(filePath).directive;
  }

  public isComponent(filePath: string, name: string): boolean {
    return this.getFileAnalysis(filePath).components.get(name) === 'Component';
  }

  public resolveImportWithPath(
    fromFile: string,
    specifier: string,
    importedName?: string,
  ): { directive: Directive; resolvedPath: string | null; isComponent: boolean } {
    const resolvedPath = this.resolveModulePath(fromFile, specifier);
    if (!resolvedPath) return { directive: null, resolvedPath: null, isComponent: false };

    const analysis = this.getFileAnalysis(resolvedPath);
    let directive = analysis.directive;
    const isComponent = importedName ? analysis.components.get(importedName) === 'Component' : false;

    if (directive === null && importedName) {
      directive = this.followReExportChain(resolvedPath, importedName, new Set());
    }
    return { directive, resolvedPath, isComponent };
  }

  public resolveImportDirective(
    fromFile: string,
    specifier: string,
    importedName?: string,
  ): Directive {
    return this.resolveImportWithPath(fromFile, specifier, importedName).directive;
  }

  public invalidate(filePath: string): void {
    this.fileCache.delete(filePath);
    for (const key of this.reExportCache.keys()) {
      if (key.startsWith(`${filePath}::`)) {
        this.reExportCache.delete(key);
      }
    }
  }

  public clear(): void {
    this.fileCache.clear();
    this.reExportCache.clear();
    this.compilerOptionsCache.clear();
  }

  private followReExportChain(
    filePath: string,
    importedName: string,
    visited: Set<string>,
  ): Directive {
    const cacheKey = `${filePath}::${importedName}`;
    if (this.reExportCache.has(cacheKey)) {
      return this.reExportCache.get(cacheKey)!;
    }

    if (visited.has(filePath)) return null;
    visited.add(filePath);

    let code: string;
    try {
      code = fs.readFileSync(filePath, 'utf-8');
    } catch {
      return null;
    }

    let ast: parser.ParseResult<import('@babel/types').File>;
    try {
      ast = parser.parse(code, {
        sourceType: 'module',
        plugins: ['jsx', 'typescript'],
        errorRecovery: true,
      });
    } catch {
      return null;
    }

    for (const node of ast.program.body) {
      if (node.type === 'ExportNamedDeclaration' && node.source) {
        for (const spec of node.specifiers) {
          if (spec.type !== 'ExportSpecifier') continue;
          const exportedName =
            spec.exported.type === 'Identifier' ? spec.exported.name : spec.exported.value;
          if (exportedName !== importedName) continue;

          const sourcePath = this.resolveModulePath(filePath, node.source.value);
          if (!sourcePath) continue;

          const sourceDirective = this.getDirective(sourcePath);
          if (sourceDirective !== null) {
            this.reExportCache.set(cacheKey, sourceDirective);
            return sourceDirective;
          }

          const chained = this.followReExportChain(sourcePath, importedName, visited);
          this.reExportCache.set(cacheKey, chained);
          return chained;
        }

        // Star re-exports via ExportNamedDeclaration with no specifiers
        if (node.specifiers.length === 0) {
          const result = this.resolveStarExport(filePath, node.source.value, importedName, visited);
          if (result !== null) {
            this.reExportCache.set(cacheKey, result);
            return result;
          }
        }
      }

      if (node.type === 'ExportAllDeclaration') {
        const result = this.resolveStarExport(filePath, node.source.value, importedName, visited);
        if (result !== null) {
          this.reExportCache.set(cacheKey, result);
          return result;
        }
      }
    }

    this.reExportCache.set(cacheKey, null);
    return null;
  }

  private resolveStarExport(
    filePath: string,
    sourceSpecifier: string,
    importedName: string,
    visited: Set<string>,
  ): Directive {
    const sourcePath = this.resolveModulePath(filePath, sourceSpecifier);
    if (!sourcePath) return null;

    const sourceDirective = this.getDirective(sourcePath);
    if (sourceDirective !== null) return sourceDirective;

    return this.followReExportChain(sourcePath, importedName, visited);
  }
}
