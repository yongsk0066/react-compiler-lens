import * as fs from 'node:fs';
import * as path from 'node:path';
import * as ts from 'typescript';
import * as parser from '@babel/parser';
import { extractFileDirective } from './directives';
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

export class ImportResolver {
  private directiveCache = new Map<string, Directive>();
  private compilerOptionsCache = new Map<string, ts.CompilerOptions>();

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

    return result.resolvedModule?.resolvedFileName ?? null;
  }

  public getDirective(filePath: string): Directive {
    if (this.directiveCache.has(filePath)) {
      return this.directiveCache.get(filePath)!;
    }

    let directive: Directive = null;
    try {
      const code = fs.readFileSync(filePath, 'utf-8');
      directive = extractFileDirective(code);
    } catch {
      directive = null;
    }

    this.directiveCache.set(filePath, directive);
    return directive;
  }

  public resolveImportWithPath(
    fromFile: string,
    specifier: string,
    importedName?: string,
  ): { directive: Directive; resolvedPath: string | null } {
    const resolvedPath = this.resolveModulePath(fromFile, specifier);
    if (!resolvedPath) return { directive: null, resolvedPath: null };

    let directive = this.getDirective(resolvedPath);
    if (directive === null && importedName) {
      directive = this.followReExportChain(resolvedPath, importedName, new Set());
    }
    return { directive, resolvedPath };
  }

  public resolveImportDirective(
    fromFile: string,
    specifier: string,
    importedName?: string,
  ): Directive {
    return this.resolveImportWithPath(fromFile, specifier, importedName).directive;
  }

  public invalidate(filePath: string): void {
    this.directiveCache.delete(filePath);
  }

  public clear(): void {
    this.directiveCache.clear();
    this.compilerOptionsCache.clear();
  }

  private followReExportChain(
    filePath: string,
    importedName: string,
    visited: Set<string>,
  ): Directive {
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
          if (sourceDirective !== null) return sourceDirective;

          return this.followReExportChain(sourcePath, importedName, visited);
        }

        // Star re-exports via ExportNamedDeclaration with no specifiers
        if (node.specifiers.length === 0) {
          const result = this.resolveStarExport(filePath, node.source.value, importedName, visited);
          if (result !== null) return result;
        }
      }

      if (node.type === 'ExportAllDeclaration') {
        const result = this.resolveStarExport(filePath, node.source.value, importedName, visited);
        if (result !== null) return result;
      }
    }

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
