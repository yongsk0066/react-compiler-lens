/**
 * Directive found in a file or function body.
 */
export type Directive = 'use client' | 'use server' | null;

/**
 * Detected framework for the workspace.
 */
export type Framework = 'nextjs' | 'none';

/**
 * Compilation result for a declared component.
 */
export type CompileResult =
  | {
      status: 'success';
      compiledCode: string;
      memoSlots: number;
      memoBlocks: number;
      memoValues: number;
      prunedMemoBlocks: number;
      prunedMemoValues: number;
    }
  | {
      status: 'error';
      diagnostics: DiagnosticInfo[];
    }
  | {
      status: 'skip';
      reason: string;
    };

/**
 * Normalized diagnostic from compiler errors.
 */
export interface DiagnosticInfo {
  message: string;
  line: number | null;
  column: number | null;
  severity: 'error' | 'warning';
}

/**
 * Analysis result for a component declared in the current file.
 */
export interface DeclaredComponentAnalysis {
  name: string;
  location: { line: number; column: number };
  directive: Directive;
  compileResult: CompileResult;
}

/**
 * Analysis result for an imported component.
 */
export interface ImportedComponentAnalysis {
  name: string;
  importLocation: { line: number; column: number };
  jsxLocations: { line: number; column: number }[];
  directive: Directive;
  sourceFilePath: string;
}

/**
 * Complete analysis result for a file.
 */
export interface FileAnalysisResult {
  filePath: string;
  directive: Directive;
  framework: Framework;
  declaredComponents: DeclaredComponentAnalysis[];
  importedComponents: ImportedComponentAnalysis[];
  compiledCode: string | null;
}
