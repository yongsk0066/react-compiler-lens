import * as fs from 'node:fs';
import * as path from 'node:path';
import * as ts from 'typescript';
import { extractFileDirective } from './directives';
import type { Directive } from '@react-compiler-lens/shared';

const DEFAULT_COMPILER_OPTIONS: ts.CompilerOptions = {
  target: ts.ScriptTarget.ESNext,
  module: ts.ModuleKind.ESNext,
  moduleResolution: ts.ModuleResolutionKind.Bundler,
  jsx: ts.JsxEmit.ReactJSX,
  allowJs: true,
};

/**
 * Resolves TypeScript compiler options for a given directory, respecting
 * tsconfig.json if found. Results are cached per directory.
 */
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
  /** Cache: resolved absolute file path → directive */
  private directiveCache = new Map<string, Directive>();

  /** Cache: compiler options per directory */
  private compilerOptionsCache = new Map<string, ts.CompilerOptions>();

  /**
   * Resolves the compiler options for a given directory, with caching.
   */
  private getCompilerOptions(dir: string): ts.CompilerOptions {
    if (this.compilerOptionsCache.has(dir)) {
      return this.compilerOptionsCache.get(dir)!;
    }
    const options = loadCompilerOptions(dir);
    this.compilerOptionsCache.set(dir, options);
    return options;
  }

  /**
   * Resolves a module specifier relative to `fromFile` to an absolute file
   * path using TypeScript's module resolution algorithm.
   *
   * Returns `null` if the module cannot be resolved.
   */
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
    return resolved;
  }

  /**
   * Reads a file and extracts its file-level directive, caching the result.
   *
   * Returns `null` if the file cannot be read or has no directive.
   */
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

  /**
   * Resolves a module specifier from `fromFile` and returns its file-level
   * directive, or `null` if the module cannot be resolved or has no directive.
   */
  public resolveImportDirective(fromFile: string, specifier: string): Directive {
    const resolvedPath = this.resolveModulePath(fromFile, specifier);
    if (!resolvedPath) return null;
    return this.getDirective(resolvedPath);
  }

  /**
   * Invalidates the cached directive for a specific file path.
   */
  public invalidate(filePath: string): void {
    this.directiveCache.delete(filePath);
  }

  /**
   * Clears all caches (directives and compiler options).
   */
  public clear(): void {
    this.directiveCache.clear();
    this.compilerOptionsCache.clear();
  }
}
