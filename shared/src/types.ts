export type Directive = 'use client' | 'use server' | null;

export type Framework = 'nextjs' | 'none';

export type CompileResult =
  | {
      status: 'success';
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

export interface DiagnosticInfo {
  message: string;
  line: number | null;
  column: number | null;
  severity: 'error' | 'warning' | 'info';
}

export interface DeclaredComponentAnalysis {
  name: string;
  location: { line: number; column: number };
  directive: Directive;
  compileResult: CompileResult;
}

export interface ImportedComponentAnalysis {
  name: string;
  importLocation: { line: number; column: number };
  jsxLocations: { line: number; column: number }[];
  directive: Directive;
  sourceFilePath: string;
}

export interface FileAnalysisResult {
  filePath: string;
  directive: Directive;
  framework: Framework;
  declaredComponents: DeclaredComponentAnalysis[];
  importedComponents: ImportedComponentAnalysis[];
  compiledCode: string | null;
  /** Warnings/suggestions from the compiler — informational, not blocking. */
  compilerDiagnostics: DiagnosticInfo[];
}
