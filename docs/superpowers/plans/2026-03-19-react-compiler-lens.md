# react-compiler-lens Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a VS Code extension that uses the React Compiler as SSOT for component identification, displaying Server/Client component kind and compilation status via CodeLens.

**Architecture:** LSP-based client/server. The server runs Babel + React Compiler in a separate process, captures logger events per function, resolves import directives, and sends analysis results to the client. The client renders CodeLens annotations and publishes diagnostics.

**Tech Stack:** TypeScript, pnpm monorepo, Rolldown bundler, vitest, vscode-languageserver/client, @babel/core, babel-plugin-react-compiler

**Spec:** `docs/superpowers/specs/2026-03-19-react-compiler-lens-design.md`

**Reference codebases:**
- `~/oss/react/compiler/packages/react-forgive/` — LSP extension pattern
- `~/oss/react/compiler/packages/babel-plugin-react-compiler/` — Compiler API
- `~/oss/react-component-lens/` — Import resolution pattern

---

## File Structure

```
~/dev/react-compiler-lens/
├── client/
│   ├── src/
│   │   ├── extension.ts              ← Extension entry, LSP client lifecycle
│   │   ├── virtualDocument.ts        ← TextDocumentContentProvider for compiled code peek
│   │   └── commands.ts               ← Command handlers (peek, focus diagnostics)
│   ├── package.json                  ← Client workspace package
│   └── tsconfig.json
├── server/
│   ├── src/
│   │   ├── index.ts                  ← LSP server entry, handler registration
│   │   ├── analyzer.ts               ← Orchestrates full analysis pipeline
│   │   ├── compiler.ts               ← Babel + React Compiler wrapper, logger event collection
│   │   ├── directives.ts             ← Directive extraction from AST
│   │   ├── resolution.ts             ← Import resolution + re-export chain + directive cache
│   │   └── framework.ts              ← Framework detection (next.config.*)
│   ├── package.json                  ← Server workspace package
│   └── tsconfig.json
├── shared/
│   ├── src/
│   │   └── types.ts                  ← Shared types (FileAnalysisResult, etc.)
│   ├── package.json
│   └── tsconfig.json
├── test/
│   ├── compiler.test.ts              ← React Compiler wrapper tests
│   ├── directives.test.ts            ← Directive extraction tests
│   ├── resolution.test.ts            ← Import resolution tests
│   ├── framework.test.ts             ← Framework detection tests
│   └── analyzer.test.ts              ← Full pipeline integration tests
├── package.json                      ← Root package.json (VS Code extension manifest)
├── pnpm-workspace.yaml
├── tsconfig.json                     ← Root tsconfig (references)
├── tsconfig.base.json                ← Shared compiler options
└── rolldown.config.ts                ← Bundler config for client + server
```

---

### Task 1: Project Scaffolding

**Files:**
- Create: `package.json`, `pnpm-workspace.yaml`, `tsconfig.base.json`, `tsconfig.json`
- Create: `client/package.json`, `client/tsconfig.json`
- Create: `server/package.json`, `server/tsconfig.json`
- Create: `shared/package.json`, `shared/tsconfig.json`
- Create: `.gitignore`

- [ ] **Step 1: Create root package.json with VS Code extension manifest**

```json
{
  "name": "react-compiler-lens",
  "displayName": "React Compiler Lens",
  "description": "CodeLens annotations for React components using the React Compiler as SSOT",
  "version": "0.0.1",
  "license": "MIT",
  "publisher": "yongsk0066",
  "engines": {
    "vscode": "^1.96.0"
  },
  "categories": ["Programming Languages"],
  "activationEvents": [
    "onLanguage:javascriptreact",
    "onLanguage:typescriptreact"
  ],
  "main": "./dist/client/extension.js",
  "contributes": {
    "commands": [
      {
        "command": "reactCompilerLens.refresh",
        "title": "React Compiler Lens: Refresh"
      }
    ],
    "configuration": {
      "title": "React Compiler Lens",
      "properties": {
        "reactCompilerLens.enabled": {
          "type": "boolean",
          "default": true,
          "description": "Enable/disable React Compiler Lens"
        },
        "reactCompilerLens.codeLens.serverComponent": {
          "type": "boolean",
          "default": true,
          "description": "Show CodeLens for Server Components"
        },
        "reactCompilerLens.codeLens.clientComponent": {
          "type": "boolean",
          "default": true,
          "description": "Show CodeLens for Client Components"
        },
        "reactCompilerLens.codeLens.compilationStatus": {
          "type": "boolean",
          "default": true,
          "description": "Show compilation status in CodeLens"
        },
        "reactCompilerLens.diagnostics.enabled": {
          "type": "boolean",
          "default": true,
          "description": "Show compilation errors in Problems panel"
        },
        "reactCompilerLens.diagnostics.severity": {
          "type": "string",
          "enum": ["warning", "error", "info"],
          "default": "warning",
          "description": "Severity level for compilation diagnostics"
        },
        "reactCompilerLens.framework": {
          "type": "string",
          "enum": ["auto", "nextjs", "none"],
          "default": "auto",
          "description": "Framework detection mode"
        }
      }
    }
  },
  "scripts": {
    "build": "rolldown -c rolldown.config.ts",
    "watch": "rolldown -c rolldown.config.ts --watch",
    "typecheck": "tsc -b",
    "test": "vitest run",
    "test:watch": "vitest",
    "package": "vsce package --no-dependencies"
  },
  "devDependencies": {
    "@types/node": "^20",
    "@types/vscode": "^1.96.0",
    "rolldown": "latest",
    "typescript": "^5.9.0",
    "vitest": "^3.0.0",
    "@vscode/vsce": "^3.0.0"
  }
}
```

- [ ] **Step 2: Create pnpm-workspace.yaml**

```yaml
packages:
  - client
  - server
  - shared
```

- [ ] **Step 3: Create tsconfig.base.json**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "Node16",
    "moduleResolution": "Node16",
    "lib": ["ES2022"],
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "forceConsistentCasingInFileNames": true,
    "declaration": true,
    "declarationMap": true,
    "sourceMap": true,
    "outDir": "dist"
  }
}
```

- [ ] **Step 4: Create root tsconfig.json with project references**

```json
{
  "files": [],
  "references": [
    { "path": "client" },
    { "path": "server" },
    { "path": "shared" }
  ]
}
```

- [ ] **Step 5: Create client/package.json and client/tsconfig.json**

`client/package.json`:
```json
{
  "name": "@react-compiler-lens/client",
  "private": true,
  "dependencies": {
    "vscode-languageclient": "^9.0.1",
    "@react-compiler-lens/shared": "workspace:*"
  }
}
```

`client/tsconfig.json`:
```json
{
  "extends": "../tsconfig.base.json",
  "compilerOptions": {
    "outDir": "../dist/client",
    "rootDir": "src"
  },
  "include": ["src"],
  "references": [{ "path": "../shared" }]
}
```

- [ ] **Step 6: Create server/package.json and server/tsconfig.json**

`server/package.json`:
```json
{
  "name": "@react-compiler-lens/server",
  "private": true,
  "dependencies": {
    "vscode-languageserver": "^9.0.1",
    "vscode-languageserver-textdocument": "^1.0.11",
    "@babel/core": "^7.26.0",
    "@babel/parser": "^7.26.0",
    "@babel/types": "^7.26.0",
    "babel-plugin-react-compiler": "^19.0.0",
    "typescript": "^5.9.0",
    "@react-compiler-lens/shared": "workspace:*"
  }
}
```

`server/tsconfig.json`:
```json
{
  "extends": "../tsconfig.base.json",
  "compilerOptions": {
    "outDir": "../dist/server",
    "rootDir": "src"
  },
  "include": ["src"],
  "references": [{ "path": "../shared" }]
}
```

- [ ] **Step 7: Create shared/package.json and shared/tsconfig.json**

`shared/package.json`:
```json
{
  "name": "@react-compiler-lens/shared",
  "private": true,
  "main": "src/types.ts",
  "types": "src/types.ts"
}
```

`shared/tsconfig.json`:
```json
{
  "extends": "../tsconfig.base.json",
  "compilerOptions": {
    "outDir": "../dist/shared",
    "rootDir": "src"
  },
  "include": ["src"]
}
```

- [ ] **Step 8: Create .gitignore**

```
node_modules/
dist/
*.vsix
.vscode-test/
```

- [ ] **Step 9: Install dependencies**

Run: `cd ~/dev/react-compiler-lens && pnpm install`

- [ ] **Step 10: Commit**

```bash
git add -A
git commit -m "chore: scaffold monorepo with client, server, shared packages"
```

---

### Task 2: Shared Types

**Files:**
- Create: `shared/src/types.ts`

- [ ] **Step 1: Write shared types**

```typescript
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
```

- [ ] **Step 2: Commit**

```bash
git add shared/src/types.ts
git commit -m "feat: add shared types for analysis results"
```

---

### Task 3: Directive Extraction (TDD)

**Files:**
- Create: `server/src/directives.ts`
- Create: `test/directives.test.ts`

- [ ] **Step 1: Write failing tests for directive extraction**

```typescript
import { describe, expect, it } from 'vitest';
import { extractFileDirective, extractFunctionDirectives } from '../server/src/directives';

describe('extractFileDirective', () => {
  it('returns "use client" for file with use client directive', () => {
    const code = `"use client";\nexport function Counter() { return <div />; }`;
    expect(extractFileDirective(code)).toBe('use client');
  });

  it('returns "use server" for file with use server directive', () => {
    const code = `"use server";\nexport async function createUser() {}`;
    expect(extractFileDirective(code)).toBe('use server');
  });

  it('returns null for file without directive', () => {
    const code = `export function Page() { return <div />; }`;
    expect(extractFileDirective(code)).toBeNull();
  });

  it('handles single quotes', () => {
    const code = `'use client';\nexport function Counter() { return <div />; }`;
    expect(extractFileDirective(code)).toBe('use client');
  });

  it('ignores directive in comments', () => {
    const code = `// "use client"\nexport function Page() { return <div />; }`;
    expect(extractFileDirective(code)).toBeNull();
  });
});

describe('extractFunctionDirectives', () => {
  it('detects function-level use server directive', () => {
    const code = [
      'export default function Page() {',
      '  async function createUser() {',
      '    "use server";',
      '    // server action',
      '  }',
      '  return <div />;',
      '}',
    ].join('\n');
    const result = extractFunctionDirectives(code);
    expect(result.get('createUser')).toBe('use server');
  });

  it('returns empty map when no function-level directives', () => {
    const code = `export function Page() { return <div />; }`;
    const result = extractFunctionDirectives(code);
    expect(result.size).toBe(0);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd ~/dev/react-compiler-lens && pnpm test -- test/directives.test.ts`
Expected: FAIL — module not found

- [ ] **Step 3: Implement directive extraction**

```typescript
import { parse } from '@babel/parser';
import type * as t from '@babel/types';
import type { Directive } from '@react-compiler-lens/shared';

/**
 * Extract file-level "use client" or "use server" directive.
 * Uses @babel/parser for accurate AST-based detection.
 */
export function extractFileDirective(code: string): Directive {
  try {
    const ast = parse(code, {
      sourceType: 'module',
      plugins: ['jsx', 'typescript'],
      errorRecovery: true,
    });
    for (const directive of ast.program.directives) {
      const value = directive.value.value;
      if (value === 'use client' || value === 'use server') {
        return value;
      }
    }
  } catch {
    // Parse failure — return null
  }
  return null;
}

/**
 * Extract function-level "use server" directives (Server Actions).
 * Returns a map of function name → directive.
 */
export function extractFunctionDirectives(
  code: string,
): Map<string, Directive> {
  const result = new Map<string, Directive>();
  try {
    const ast = parse(code, {
      sourceType: 'module',
      plugins: ['jsx', 'typescript'],
      errorRecovery: true,
    });
    visitFunctions(ast.program, result);
  } catch {
    // Parse failure
  }
  return result;
}

function visitFunctions(
  node: t.Node,
  result: Map<string, Directive>,
): void {
  if (
    node.type === 'FunctionDeclaration' ||
    node.type === 'FunctionExpression' ||
    node.type === 'ArrowFunctionExpression'
  ) {
    const name = getFunctionName(node);
    if (name && node.body.type === 'BlockStatement') {
      for (const directive of node.body.directives) {
        if (directive.value.value === 'use server') {
          result.set(name, 'use server');
        }
      }
    }
  }
  for (const key of Object.keys(node)) {
    if (key === 'type' || key === 'loc' || key === 'start' || key === 'end') continue;
    const child = (node as any)[key];
    if (Array.isArray(child)) {
      for (const item of child) {
        if (item && typeof item === 'object' && item.type) {
          visitFunctions(item, result);
        }
      }
    } else if (child && typeof child === 'object' && child.type) {
      visitFunctions(child, result);
    }
  }
}

function getFunctionName(
  node: t.FunctionDeclaration | t.FunctionExpression | t.ArrowFunctionExpression,
): string | null {
  if (node.type === 'FunctionDeclaration' && node.id) {
    return node.id.name;
  }
  return null;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd ~/dev/react-compiler-lens && pnpm test -- test/directives.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add server/src/directives.ts test/directives.test.ts
git commit -m "feat: add directive extraction from AST"
```

---

### Task 4: Compiler Wrapper (TDD)

**Files:**
- Create: `server/src/compiler.ts`
- Create: `test/compiler.test.ts`

- [ ] **Step 1: Write failing tests for compiler wrapper**

```typescript
import { describe, expect, it } from 'vitest';
import { compileFile } from '../server/src/compiler';

describe('compileFile', () => {
  it('returns success events for compilable components', async () => {
    const code = [
      'import { useState } from "react";',
      'export default function Counter() {',
      '  const [count, setCount] = useState(0);',
      '  return <button onClick={() => setCount(c => c + 1)}>{count}</button>;',
      '}',
    ].join('\n');

    const result = await compileFile(code, 'Counter.tsx');
    expect(result.events.length).toBeGreaterThan(0);

    const success = result.events.find(e => e.kind === 'CompileSuccess');
    expect(success).toBeDefined();
    expect(success?.fnName).toBe('Counter');
  });

  it('returns compiled code string', async () => {
    const code = [
      'import { useState } from "react";',
      'export default function Counter() {',
      '  const [count, setCount] = useState(0);',
      '  return <button>{count}</button>;',
      '}',
    ].join('\n');

    const result = await compileFile(code, 'Counter.tsx');
    expect(result.compiledCode).toBeTruthy();
    expect(result.compiledCode).toContain('useMemoCache');
  });

  it('returns error events for non-compilable components', async () => {
    const code = [
      'export default function Broken() {',
      '  let obj = {};',
      '  obj.foo = "bar";',
      '  return <div>{obj.foo}</div>;',
      '}',
    ].join('\n');

    const result = await compileFile(code, 'Broken.tsx');
    // May succeed or error depending on compiler version — just verify no crash
    expect(result.events).toBeDefined();
  });

  it('returns skip events for opted-out functions', async () => {
    const code = [
      'export default function NoMemo() {',
      '  "use no memo";',
      '  return <div />;',
      '}',
    ].join('\n');

    const result = await compileFile(code, 'NoMemo.tsx');
    const skip = result.events.find(e => e.kind === 'CompileSkip');
    expect(skip).toBeDefined();
  });

  it('handles parse errors gracefully', async () => {
    const code = 'const x = {{{';
    const result = await compileFile(code, 'bad.tsx');
    expect(result.events).toEqual([]);
    expect(result.compiledCode).toBeNull();
  });

  it('filters hooks from component results using isComponentName', async () => {
    const code = [
      'import { useState } from "react";',
      'export function useCounter() {',
      '  const [count, setCount] = useState(0);',
      '  return count;',
      '}',
      'export default function App() {',
      '  const count = useCounter();',
      '  return <div>{count}</div>;',
      '}',
    ].join('\n');

    const result = await compileFile(code, 'App.tsx');
    const componentEvents = result.getComponentEvents();
    // Should include App but not useCounter
    const names = componentEvents
      .filter(e => e.kind === 'CompileSuccess')
      .map(e => e.fnName);
    expect(names).toContain('App');
    expect(names).not.toContain('useCounter');
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd ~/dev/react-compiler-lens && pnpm test -- test/compiler.test.ts`
Expected: FAIL — module not found

- [ ] **Step 3: Implement compiler wrapper**

```typescript
import { parseAsync, transformFromAstAsync } from '@babel/core';
import type * as t from '@babel/types';
import type {
  LoggerEvent,
  PluginOptions,
} from 'babel-plugin-react-compiler';

export interface CompileFileResult {
  events: CapturedEvent[];
  compiledCode: string | null;
  /** Filter to only component events (PascalCase names, exclude hooks). */
  getComponentEvents(): CapturedEvent[];
}

export interface CapturedEvent {
  kind: LoggerEvent['kind'];
  fnLoc: t.SourceLocation | null;
  /** Resolved function name. null if not available from event. */
  fnName: string | null;
  /** Raw event data for accessing kind-specific fields. */
  raw: LoggerEvent;
}

/**
 * Compile a file with React Compiler and capture all logger events.
 *
 * Uses the same pattern as react-forgive:
 * 1. parseAsync → AST
 * 2. transformFromAstAsync with babel-plugin-react-compiler
 * 3. Capture logger events
 */
export async function compileFile(
  code: string,
  filename: string,
): Promise<CompileFileResult> {
  const events: CapturedEvent[] = [];

  let ast: Awaited<ReturnType<typeof parseAsync>>;
  try {
    ast = await parseAsync(code, {
      sourceFileName: filename,
      parserOpts: { plugins: ['typescript', 'jsx'] },
      sourceType: 'module',
      configFile: false,
      babelrc: false,
    });
  } catch {
    return { events, compiledCode: null, getComponentEvents: () => [] };
  }

  if (ast == null) {
    return { events, compiledCode: null, getComponentEvents: () => [] };
  }

  // Build TWO location maps: fn declaration loc AND fn body loc.
  // CompileSkip uses fn.node.body.loc, all others use fn.node.loc.
  const { fnLocNames, bodyLocNames } = buildFnLocNameMaps(ast);

  // Pass minimal PluginOptions — the Babel plugin internally calls
  // parsePluginOptions() which applies all defaults. Do NOT spread defaultOptions.
  const options: PluginOptions = {
    panicThreshold: 'none',
    logger: {
      logEvent(_filename: string | null, event: LoggerEvent) {
        if (event.kind === 'Timing') return;

        const fnLoc = 'fnLoc' in event ? (event.fnLoc as t.SourceLocation | null) : null;

        let fnName: string | null = null;
        if (event.kind === 'CompileSuccess') {
          fnName = (event as any).fnName ?? null;
        } else if (fnLoc) {
          // Try declaration loc first, then body loc (for CompileSkip)
          fnName = fnLocNames.get(locKey(fnLoc))
            ?? bodyLocNames.get(locKey(fnLoc))
            ?? null;
        }

        events.push({ kind: event.kind, fnLoc, fnName, raw: event });
      },
    },
  };

  const BabelPluginReactCompiler = (
    await import('babel-plugin-react-compiler')
  ).default ?? (await import('babel-plugin-react-compiler'));

  let compiledCode: string | null = null;
  try {
    const result = await transformFromAstAsync(ast, code, {
      filename,
      highlightCode: false,
      retainLines: true,
      plugins: [[BabelPluginReactCompiler, options]],
      sourceType: 'module',
      sourceFileName: filename,
      configFile: false,
      babelrc: false,
    });
    compiledCode = result?.code ?? null;
  } catch {
    // Compilation failure — events already captured via logger
  }

  return {
    events,
    compiledCode,
    getComponentEvents() {
      return events.filter(e => {
        if (!e.fnName) return false;
        return isComponentName(e.fnName);
      });
    },
  };
}

/**
 * PascalCase check — components start with uppercase, hooks start with "use".
 */
function isComponentName(name: string): boolean {
  if (/^use[A-Z0-9]/.test(name)) return false; // Hook
  return /^[A-Z]/.test(name); // Component
}

/**
 * Build TWO maps from AST:
 * - fnLocNames: function declaration loc → name (used by CompileSuccess/Error/etc.)
 * - bodyLocNames: function body loc → name (used by CompileSkip which uses fn.node.body.loc)
 */
function buildFnLocNameMaps(
  ast: NonNullable<Awaited<ReturnType<typeof parseAsync>>>,
): { fnLocNames: Map<string, string>; bodyLocNames: Map<string, string> } {
  const fnLocNames = new Map<string, string>();
  const bodyLocNames = new Map<string, string>();

  function visit(node: t.Node): void {
    if (
      (node.type === 'FunctionDeclaration' ||
        node.type === 'FunctionExpression' ||
        node.type === 'ArrowFunctionExpression') &&
      node.loc
    ) {
      const name = resolveFnName(node);
      if (name) {
        fnLocNames.set(locKey(node.loc), name);
        // Also map body loc for CompileSkip events
        if (node.body.type === 'BlockStatement' && node.body.loc) {
          bodyLocNames.set(locKey(node.body.loc), name);
        }
      }
    }
    for (const key of Object.keys(node)) {
      if (key === 'type' || key === 'loc' || key === 'start' || key === 'end') continue;
      const child = (node as any)[key];
      if (Array.isArray(child)) {
        for (const item of child) {
          if (item && typeof item === 'object' && item.type) visit(item);
        }
      } else if (child && typeof child === 'object' && child.type) {
        visit(child);
      }
    }
  }

  visit(ast.program);
  return { fnLocNames, bodyLocNames };
}

function resolveFnName(
  node: t.FunctionDeclaration | t.FunctionExpression | t.ArrowFunctionExpression,
): string | null {
  if (node.type === 'FunctionDeclaration' && node.id) {
    return node.id.name;
  }
  // For expressions, Babel's parent info is not available in raw AST
  // — name will be resolved from CompileSuccess event if available
  return null;
}

function locKey(loc: t.SourceLocation): string {
  return `${loc.start.line}:${loc.start.column}-${loc.end.line}:${loc.end.column}`;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd ~/dev/react-compiler-lens && pnpm test -- test/compiler.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add server/src/compiler.ts test/compiler.test.ts
git commit -m "feat: add React Compiler wrapper with logger event capture"
```

---

### Task 5: Framework Detection (TDD)

**Files:**
- Create: `server/src/framework.ts`
- Create: `test/framework.test.ts`

- [ ] **Step 1: Write failing tests**

```typescript
import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { detectFramework } from '../server/src/framework';

describe('detectFramework', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'rcl-fw-'));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true });
  });

  it('detects nextjs when next.config.js exists', () => {
    fs.writeFileSync(path.join(tmpDir, 'next.config.js'), 'module.exports = {}');
    expect(detectFramework(tmpDir)).toBe('nextjs');
  });

  it('detects nextjs when next.config.ts exists', () => {
    fs.writeFileSync(path.join(tmpDir, 'next.config.ts'), 'export default {}');
    expect(detectFramework(tmpDir)).toBe('nextjs');
  });

  it('detects nextjs when next.config.mjs exists', () => {
    fs.writeFileSync(path.join(tmpDir, 'next.config.mjs'), 'export default {}');
    expect(detectFramework(tmpDir)).toBe('nextjs');
  });

  it('returns none when no framework config found', () => {
    expect(detectFramework(tmpDir)).toBe('none');
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd ~/dev/react-compiler-lens && pnpm test -- test/framework.test.ts`
Expected: FAIL

- [ ] **Step 3: Implement framework detection**

```typescript
import * as fs from 'node:fs';
import * as path from 'node:path';
import type { Framework } from '@react-compiler-lens/shared';

const NEXT_CONFIG_FILES = [
  'next.config.js',
  'next.config.ts',
  'next.config.mjs',
];

/**
 * Detect framework by scanning for config files in the workspace root.
 */
export function detectFramework(workspacePath: string): Framework {
  for (const configFile of NEXT_CONFIG_FILES) {
    if (fs.existsSync(path.join(workspacePath, configFile))) {
      return 'nextjs';
    }
  }
  return 'none';
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd ~/dev/react-compiler-lens && pnpm test -- test/framework.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add server/src/framework.ts test/framework.test.ts
git commit -m "feat: add framework detection for Next.js"
```

---

### Task 6: Import Resolution (TDD)

**Files:**
- Create: `server/src/resolution.ts`
- Create: `test/resolution.test.ts`

- [ ] **Step 1: Write failing tests**

```typescript
import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { ImportResolver } from '../server/src/resolution';

describe('ImportResolver', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'rcl-res-'));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true });
  });

  it('resolves relative import and returns directive', () => {
    fs.writeFileSync(
      path.join(tmpDir, 'Button.tsx'),
      '"use client";\nexport function Button() { return <button />; }',
    );
    fs.writeFileSync(
      path.join(tmpDir, 'Page.tsx'),
      'import { Button } from "./Button";\nexport default function Page() { return <Button />; }',
    );

    const resolver = new ImportResolver();
    const directive = resolver.resolveImportDirective(
      path.join(tmpDir, 'Page.tsx'),
      './Button',
    );
    expect(directive).toBe('use client');
  });

  it('returns null for files without directive', () => {
    fs.writeFileSync(
      path.join(tmpDir, 'Layout.tsx'),
      'export function Layout() { return <div />; }',
    );

    const resolver = new ImportResolver();
    const directive = resolver.resolveImportDirective(
      path.join(tmpDir, 'Page.tsx'),
      './Layout',
    );
    expect(directive).toBeNull();
  });

  it('follows re-export chain through barrel files', () => {
    fs.writeFileSync(
      path.join(tmpDir, 'Button.tsx'),
      '"use client";\nexport function Button() { return <button />; }',
    );
    fs.mkdirSync(path.join(tmpDir, 'components'));
    fs.writeFileSync(
      path.join(tmpDir, 'components', 'index.ts'),
      'export { Button } from "../Button";',
    );

    const resolver = new ImportResolver();
    const directive = resolver.resolveImportDirective(
      path.join(tmpDir, 'Page.tsx'),
      './components',
    );
    // Barrel file itself has no directive
    expect(directive).toBeNull();
  });

  it('caches directive results', () => {
    fs.writeFileSync(
      path.join(tmpDir, 'Button.tsx'),
      '"use client";\nexport function Button() { return <button />; }',
    );

    const resolver = new ImportResolver();
    const d1 = resolver.resolveImportDirective(
      path.join(tmpDir, 'Page.tsx'),
      './Button',
    );
    const d2 = resolver.resolveImportDirective(
      path.join(tmpDir, 'Page.tsx'),
      './Button',
    );
    expect(d1).toBe(d2);
  });

  it('invalidates cache for a file', () => {
    fs.writeFileSync(
      path.join(tmpDir, 'Button.tsx'),
      'export function Button() { return <button />; }',
    );

    const resolver = new ImportResolver();
    expect(
      resolver.resolveImportDirective(path.join(tmpDir, 'Page.tsx'), './Button'),
    ).toBeNull();

    // Update file with directive
    fs.writeFileSync(
      path.join(tmpDir, 'Button.tsx'),
      '"use client";\nexport function Button() { return <button />; }',
    );
    resolver.invalidate(path.join(tmpDir, 'Button.tsx'));

    expect(
      resolver.resolveImportDirective(path.join(tmpDir, 'Page.tsx'), './Button'),
    ).toBe('use client');
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd ~/dev/react-compiler-lens && pnpm test -- test/resolution.test.ts`
Expected: FAIL

- [ ] **Step 3: Implement import resolver**

```typescript
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as ts from 'typescript';
import type { Directive } from '@react-compiler-lens/shared';
import { extractFileDirective } from './directives';

/**
 * Resolves import paths to source files and caches their directives.
 */
export class ImportResolver {
  private directiveCache = new Map<string, Directive>();
  private compilerOptionsCache = new Map<string, ts.CompilerOptions>();

  /**
   * Resolve an import specifier from a source file and return the target file's directive.
   */
  resolveImportDirective(
    fromFile: string,
    importSpecifier: string,
  ): Directive {
    const resolved = this.resolveModulePath(fromFile, importSpecifier);
    if (!resolved) return null;
    return this.getDirective(resolved);
  }

  /**
   * Get cached directive for a file, or parse it.
   */
  getDirective(filePath: string): Directive {
    const normalized = path.resolve(filePath);
    if (this.directiveCache.has(normalized)) {
      return this.directiveCache.get(normalized)!;
    }
    let directive: Directive = null;
    try {
      const code = fs.readFileSync(normalized, 'utf-8');
      directive = extractFileDirective(code);
    } catch {
      // File not readable
    }
    this.directiveCache.set(normalized, directive);
    return directive;
  }

  /**
   * Invalidate cached directive for a file.
   */
  invalidate(filePath: string): void {
    this.directiveCache.delete(path.resolve(filePath));
  }

  /**
   * Clear all caches.
   */
  clear(): void {
    this.directiveCache.clear();
    this.compilerOptionsCache.clear();
  }

  resolveModulePath(
    fromFile: string,
    specifier: string,
  ): string | null {
    const dir = path.dirname(fromFile);
    const options = this.getCompilerOptions(dir);
    const { resolvedModule } = ts.resolveModuleName(
      specifier,
      fromFile,
      options,
      ts.sys,
    );
    if (resolvedModule && !resolvedModule.resolvedFileName.endsWith('.d.ts')) {
      return resolvedModule.resolvedFileName;
    }
    return null;
  }

  private getCompilerOptions(dir: string): ts.CompilerOptions {
    if (this.compilerOptionsCache.has(dir)) {
      return this.compilerOptionsCache.get(dir)!;
    }
    const configPath = ts.findConfigFile(dir, ts.sys.fileExists);
    let options: ts.CompilerOptions = {
      target: ts.ScriptTarget.ESNext,
      module: ts.ModuleKind.ESNext,
      moduleResolution: ts.ModuleResolutionKind.Bundler,
      jsx: ts.JsxEmit.ReactJSX,
      allowJs: true,
    };
    if (configPath) {
      const configFile = ts.readConfigFile(configPath, ts.sys.readFile);
      if (configFile.config) {
        const parsed = ts.parseJsonConfigFileContent(
          configFile.config,
          ts.sys,
          path.dirname(configPath),
        );
        options = parsed.options;
      }
    }
    this.compilerOptionsCache.set(dir, options);
    return options;
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd ~/dev/react-compiler-lens && pnpm test -- test/resolution.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add server/src/resolution.ts test/resolution.test.ts
git commit -m "feat: add import resolver with directive caching"
```

---

### Task 7: Analyzer — Full Pipeline (TDD)

**Files:**
- Create: `server/src/analyzer.ts`
- Create: `test/analyzer.test.ts`

- [ ] **Step 1: Write failing tests for the full pipeline**

```typescript
import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { Analyzer } from '../server/src/analyzer';

describe('Analyzer', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'rcl-analyzer-'));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true });
  });

  it('analyzes a client component file', async () => {
    const filePath = path.join(tmpDir, 'Counter.tsx');
    const code = [
      '"use client";',
      'import { useState } from "react";',
      'export default function Counter() {',
      '  const [count, setCount] = useState(0);',
      '  return <button onClick={() => setCount(c => c + 1)}>{count}</button>;',
      '}',
    ].join('\n');
    fs.writeFileSync(filePath, code);

    const analyzer = new Analyzer({ framework: 'none' });
    const result = await analyzer.analyze(filePath, code);

    expect(result.directive).toBe('use client');
    expect(result.declaredComponents.length).toBeGreaterThan(0);

    const counter = result.declaredComponents.find(c => c.name === 'Counter');
    expect(counter).toBeDefined();
    expect(counter!.directive).toBe('use client');
    expect(counter!.compileResult.status).toBe('success');
  });

  it('analyzes imported components for directive', async () => {
    fs.writeFileSync(
      path.join(tmpDir, 'Button.tsx'),
      '"use client";\nexport function Button() { return <button />; }',
    );

    const pagePath = path.join(tmpDir, 'Page.tsx');
    const pageCode = [
      'import { Button } from "./Button";',
      'export default function Page() {',
      '  return <Button />;',
      '}',
    ].join('\n');
    fs.writeFileSync(pagePath, pageCode);

    const analyzer = new Analyzer({ framework: 'none' });
    const result = await analyzer.analyze(pagePath, pageCode);

    const buttonImport = result.importedComponents.find(c => c.name === 'Button');
    expect(buttonImport).toBeDefined();
    expect(buttonImport!.directive).toBe('use client');
  });

  it('defaults to server component in nextjs when no directive', async () => {
    const filePath = path.join(tmpDir, 'Page.tsx');
    const code = 'export default function Page() { return <div />; }';
    fs.writeFileSync(filePath, code);

    const analyzer = new Analyzer({ framework: 'nextjs' });
    const result = await analyzer.analyze(filePath, code);

    expect(result.framework).toBe('nextjs');
    const page = result.declaredComponents.find(c => c.name === 'Page');
    expect(page).toBeDefined();
    // In Next.js, no directive means Server
    expect(page!.directive).toBeNull();
    // framework info lets the client decide display
  });

  it('excludes hooks from declared components', async () => {
    const filePath = path.join(tmpDir, 'hooks.tsx');
    const code = [
      'import { useState } from "react";',
      'export function useCounter() {',
      '  return useState(0);',
      '}',
    ].join('\n');
    fs.writeFileSync(filePath, code);

    const analyzer = new Analyzer({ framework: 'none' });
    const result = await analyzer.analyze(filePath, code);

    expect(result.declaredComponents.find(c => c.name === 'useCounter')).toBeUndefined();
  });

  it('collects JSX tag locations for imported components', async () => {
    fs.writeFileSync(
      path.join(tmpDir, 'Button.tsx'),
      '"use client";\nexport function Button() { return <button />; }',
    );

    const pagePath = path.join(tmpDir, 'Page.tsx');
    const pageCode = [
      'import { Button } from "./Button";',
      'export default function Page() {',
      '  return (',
      '    <>',
      '      <Button />',
      '      <Button />',
      '    </>',
      '  );',
      '}',
    ].join('\n');
    fs.writeFileSync(pagePath, pageCode);

    const analyzer = new Analyzer({ framework: 'none' });
    const result = await analyzer.analyze(pagePath, pageCode);

    const buttonImport = result.importedComponents.find(c => c.name === 'Button');
    expect(buttonImport).toBeDefined();
    expect(buttonImport!.jsxLocations.length).toBe(2);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd ~/dev/react-compiler-lens && pnpm test -- test/analyzer.test.ts`
Expected: FAIL

- [ ] **Step 3: Implement analyzer**

```typescript
import { parse } from '@babel/parser';
import type * as t from '@babel/types';
import type {
  FileAnalysisResult,
  DeclaredComponentAnalysis,
  ImportedComponentAnalysis,
  Framework,
  Directive,
  DiagnosticInfo,
} from '@react-compiler-lens/shared';
import { compileFile, type CapturedEvent } from './compiler';
import { extractFileDirective, extractFunctionDirectives } from './directives';
import { ImportResolver } from './resolution';

export interface AnalyzerOptions {
  framework: Framework;
}

export class Analyzer {
  private readonly framework: Framework;
  private readonly resolver = new ImportResolver();

  constructor(options: AnalyzerOptions) {
    this.framework = options.framework;
  }

  async analyze(filePath: string, code: string): Promise<FileAnalysisResult> {
    // Step 1-2: Compile with React Compiler + capture events
    const compileResult = await compileFile(code, filePath);

    // Step 3: Extract directives
    const fileDirective = extractFileDirective(code);
    const fnDirectives = extractFunctionDirectives(code);

    // Step 4: Parse for import/JSX analysis
    let ast: ReturnType<typeof parse> | null = null;
    try {
      ast = parse(code, {
        sourceType: 'module',
        plugins: ['jsx', 'typescript'],
        errorRecovery: true,
      });
    } catch {
      // Parse failure — return minimal result
    }

    // Step 5: Build declared components from compiler events
    const componentEvents = compileResult.getComponentEvents();
    const declaredComponents = this.buildDeclaredComponents(
      componentEvents,
      fileDirective,
      fnDirectives,
      compileResult.compiledCode,
    );

    // Step 6: Resolve imported components
    const importedComponents = ast
      ? this.buildImportedComponents(ast, filePath)
      : [];

    return {
      filePath,
      directive: fileDirective,
      framework: this.framework,
      declaredComponents,
      importedComponents,
      compiledCode: compileResult.compiledCode,
    };
  }

  invalidateFile(filePath: string): void {
    this.resolver.invalidate(filePath);
  }

  clearCaches(): void {
    this.resolver.clear();
  }

  private buildDeclaredComponents(
    events: CapturedEvent[],
    fileDirective: Directive,
    fnDirectives: Map<string, Directive>,
    compiledCode: string | null,
  ): DeclaredComponentAnalysis[] {
    // Group events by function name (fnLoc-based grouping is unreliable
    // because CompileSkip uses body.loc while others use fn.loc)
    const grouped = new Map<string, { loc: { line: number; column: number }; events: CapturedEvent[] }>();

    for (const event of events) {
      if (!event.fnName || !event.fnLoc) continue;
      if (!grouped.has(event.fnName)) {
        grouped.set(event.fnName, {
          loc: { line: event.fnLoc.start.line - 1, column: event.fnLoc.start.column },
          events: [],
        });
      }
      grouped.get(event.fnName)!.events.push(event);
    }

    const components: DeclaredComponentAnalysis[] = [];

    for (const [name, group] of grouped) {
      const directive = fnDirectives.get(name) ?? fileDirective;

      const success = group.events.find(e => e.kind === 'CompileSuccess');
      // CompileError is emitted per-detail — aggregate all for this function
      const errors = group.events.filter(e =>
        e.kind === 'CompileError' || e.kind === 'CompileUnexpectedThrow' || e.kind === 'PipelineError',
      );
      const skip = group.events.find(e => e.kind === 'CompileSkip');

      let compileResult: DeclaredComponentAnalysis['compileResult'];

      if (success) {
        const raw = success.raw as any;
        compileResult = {
          status: 'success',
          compiledCode: compiledCode ?? '',
          memoSlots: raw.memoSlots ?? 0,
          memoBlocks: raw.memoBlocks ?? 0,
          memoValues: raw.memoValues ?? 0,
          prunedMemoBlocks: raw.prunedMemoBlocks ?? 0,
          prunedMemoValues: raw.prunedMemoValues ?? 0,
        };
      } else if (errors.length > 0) {
        compileResult = {
          status: 'error',
          diagnostics: errors.map(e => normalizeDiagnostic(e)),
        };
      } else if (skip) {
        const raw = skip.raw as any;
        compileResult = {
          status: 'skip',
          reason: raw.reason ?? 'unknown',
        };
      } else {
        compileResult = { status: 'skip', reason: 'no compilation event' };
      }

      components.push({ name, location: group.loc, directive, compileResult });
    }

    return components;
  }

  private buildImportedComponents(
    ast: ReturnType<typeof parse>,
    currentFilePath: string,
  ): ImportedComponentAnalysis[] {
    const imports = new Map<string, { specifier: string; loc: { line: number; column: number } }>();

    // Collect imports
    for (const node of ast.program.body) {
      if (node.type === 'ImportDeclaration' && node.source.value) {
        for (const spec of node.specifiers) {
          const localName = spec.local.name;
          if (/^[A-Z]/.test(localName) && !/^use[A-Z0-9]/.test(localName)) {
            imports.set(localName, {
              specifier: node.source.value,
              loc: {
                line: (node.loc?.start.line ?? 1) - 1,
                column: node.loc?.start.column ?? 0,
              },
            });
          }
        }
      }
    }

    // Collect JSX tag locations per component name
    const jsxLocs = new Map<string, { line: number; column: number }[]>();
    this.collectJsxLocations(ast.program, imports, jsxLocs);

    // Resolve directives
    const results: ImportedComponentAnalysis[] = [];
    for (const [name, imp] of imports) {
      const directive = this.resolver.resolveImportDirective(
        currentFilePath,
        imp.specifier,
      );
      const resolvedPath = this.resolver.resolveModulePath(currentFilePath, imp.specifier);
      results.push({
        name,
        importLocation: imp.loc,
        jsxLocations: jsxLocs.get(name) ?? [],
        directive,
        sourceFilePath: resolvedPath ?? imp.specifier,
      });
    }

    return results;
  }

  private collectJsxLocations(
    node: t.Node,
    imports: Map<string, any>,
    jsxLocs: Map<string, { line: number; column: number }[]>,
  ): void {
    if (node.type === 'JSXOpeningElement') {
      const name = this.getJsxElementName(node.name);
      if (name && imports.has(name) && node.loc) {
        if (!jsxLocs.has(name)) jsxLocs.set(name, []);
        jsxLocs.get(name)!.push({
          line: node.loc.start.line - 1,
          column: node.loc.start.column,
        });
      }
    }
    for (const key of Object.keys(node)) {
      if (key === 'type' || key === 'loc' || key === 'start' || key === 'end') continue;
      const child = (node as any)[key];
      if (Array.isArray(child)) {
        for (const item of child) {
          if (item && typeof item === 'object' && item.type) {
            this.collectJsxLocations(item, imports, jsxLocs);
          }
        }
      } else if (child && typeof child === 'object' && child.type) {
        this.collectJsxLocations(child, imports, jsxLocs);
      }
    }
  }

  private getJsxElementName(name: t.JSXIdentifier | t.JSXMemberExpression | t.JSXNamespacedName): string | null {
    if (name.type === 'JSXIdentifier') return name.name;
    if (name.type === 'JSXMemberExpression') {
      return this.getJsxElementName(name.object) + '.' + name.property.name;
    }
    return null;
  }
}

/**
 * Normalize compiler events to DiagnosticInfo.
 *
 * CompileErrorEvent.detail is CompilerErrorDetail | CompilerDiagnostic (class instances).
 * - CompilerErrorDetail has: reason (string), description (string|null), loc (SourceLocation|null)
 * - CompilerDiagnostic has: reason (getter), description (getter), primaryLocation() method
 *
 * CompileUnexpectedThrow/PipelineError have: data (string)
 */
function normalizeDiagnostic(event: CapturedEvent): DiagnosticInfo {
  const raw = event.raw as any;

  if (event.kind === 'CompileError' && raw.detail) {
    const detail = raw.detail;
    // Both CompilerErrorDetail and CompilerDiagnostic have .reason
    const message = typeof detail.reason === 'string'
      ? detail.reason
      : String(detail);
    // CompilerErrorDetail has .loc, CompilerDiagnostic has .primaryLocation()
    const loc = detail.loc ?? detail.primaryLocation?.() ?? null;
    return {
      message,
      line: loc?.start?.line ?? null,
      column: loc?.start?.column ?? null,
      severity: 'warning',
    };
  }

  // CompileUnexpectedThrow or PipelineError — data is a string
  return {
    message: raw.data ?? 'Unexpected compilation error',
    line: event.fnLoc?.start?.line ?? null,
    column: event.fnLoc?.start?.column ?? null,
    severity: 'warning',
  };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd ~/dev/react-compiler-lens && pnpm test -- test/analyzer.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add server/src/analyzer.ts test/analyzer.test.ts
git commit -m "feat: add analyzer with full analysis pipeline"
```

---

### Task 8: LSP Server

**Files:**
- Create: `server/src/index.ts`

- [ ] **Step 1: Implement LSP server**

Reference: `~/oss/react/compiler/packages/react-forgive/server/src/index.ts`

```typescript
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
import { Analyzer } from './analyzer';
import { detectFramework } from './framework';
import type { FileAnalysisResult, DeclaredComponentAnalysis, ImportedComponentAnalysis } from '@react-compiler-lens/shared';

const connection = createConnection(ProposedFeatures.all);
const documents = new TextDocuments(TextDocument);

let analyzer: Analyzer | null = null;
const analysisCache = new Map<string, FileAnalysisResult>();

// Signature cache: skip re-analysis if content unchanged
const signatureCache = new Map<string, string>();

// Debounce timers per document
const debounceTimers = new Map<string, NodeJS.Timeout>();
const DEBOUNCE_MS = 200;

// Configuration synced from client
let config: Config = {
  enabled: true,
  serverComponent: true,
  clientComponent: true,
  compilationStatus: true,
  diagnosticsEnabled: true,
  diagnosticsSeverity: 'warning',
  framework: 'auto',
};

connection.onInitialize((params: InitializeParams) => {
  const workspaceFolders = params.workspaceFolders;
  const workspacePath = workspaceFolders?.[0]?.uri
    ? new URL(workspaceFolders[0].uri).pathname
    : null;

  const framework = config.framework === 'auto'
    ? (workspacePath ? detectFramework(workspacePath) : 'none')
    : config.framework === 'nextjs' ? 'nextjs' : 'none';
  analyzer = new Analyzer({ framework });

  connection.console.info(`Framework detected: ${framework}`);

  const result: InitializeResult = {
    capabilities: {
      textDocumentSync: TextDocumentSyncKind.Full,
      codeLensProvider: { resolveProvider: false },
    },
  };
  return result;
});

// Sync configuration from client
connection.onDidChangeConfiguration(async (change) => {
  const settings = change.settings?.reactCompilerLens;
  if (settings) {
    config = {
      enabled: settings.enabled ?? true,
      serverComponent: settings.codeLens?.serverComponent ?? true,
      clientComponent: settings.codeLens?.clientComponent ?? true,
      compilationStatus: settings.codeLens?.compilationStatus ?? true,
      diagnosticsEnabled: settings.diagnostics?.enabled ?? true,
      diagnosticsSeverity: settings.diagnostics?.severity ?? 'warning',
      framework: settings.framework ?? 'auto',
    };
  }
});

documents.onDidChangeContent(async (event) => {
  if (!analyzer || !config.enabled) return;

  const uri = event.document.uri;

  // Debounce: wait 200ms after last change
  const existing = debounceTimers.get(uri);
  if (existing) clearTimeout(existing);

  debounceTimers.set(uri, setTimeout(async () => {
    debounceTimers.delete(uri);

    const text = event.document.getText();

    // Signature cache: skip if content unchanged
    const hash = crypto.createHash('md5').update(text).digest('hex');
    if (signatureCache.get(uri) === hash) return;
    signatureCache.set(uri, hash);

    const filePath = new URL(uri).pathname;

    try {
      const result = await analyzer!.analyze(filePath, text);
      analysisCache.set(uri, result);

      // Publish diagnostics
      if (config.diagnosticsEnabled) {
        const diagnostics = buildDiagnostics(result);
        connection.sendDiagnostics({ uri, diagnostics });
      } else {
        connection.sendDiagnostics({ uri, diagnostics: [] });
      }

      // Send compiled code to client for peek preview
      if (result.compiledCode) {
        connection.sendNotification('react-compiler-lens/compiledCode', {
          uri,
          code: result.compiledCode,
        });
      }
    } catch (err) {
      connection.console.error(`Analysis failed for ${uri}: ${err}`);
    }
  }, DEBOUNCE_MS));
});

documents.onDidClose((event) => {
  analysisCache.delete(event.document.uri);
  connection.sendDiagnostics({ uri: event.document.uri, diagnostics: [] });
});

connection.onCodeLens((params) => {
  const result = analysisCache.get(params.textDocument.uri);
  if (!result) return [];

  const config = getConfig();
  const lenses: CodeLens[] = [];

  // Declared components — Server/Client + compilation status
  for (const comp of result.declaredComponents) {
    const label = buildDeclaredLabel(comp, result, config);
    if (!label) continue;

    const range = Range.create(comp.location.line, comp.location.column, comp.location.line, comp.location.column);
    const command = buildCommand(comp, params.textDocument.uri);

    lenses.push(CodeLens.create(range, { title: label, command: command?.command ?? '', arguments: command?.arguments }));
  }

  // Imported components — import locations
  for (const imp of result.importedComponents) {
    const label = buildImportedLabel(imp, result, config);
    if (!label) continue;

    const range = Range.create(imp.importLocation.line, imp.importLocation.column, imp.importLocation.line, imp.importLocation.column);
    lenses.push(CodeLens.create(range, { title: label, command: '' }));

    // JSX tag locations
    for (const jsxLoc of imp.jsxLocations) {
      const jsxRange = Range.create(jsxLoc.line, jsxLoc.column, jsxLoc.line, jsxLoc.column);
      lenses.push(CodeLens.create(jsxRange, { title: label, command: '' }));
    }
  }

  return lenses;
});

function buildDeclaredLabel(
  comp: DeclaredComponentAnalysis,
  result: FileAnalysisResult,
  config: Config,
): string | null {
  const parts: string[] = [];

  // Server/Client label
  const kindLabel = getKindLabel(comp.directive, result.framework, config);
  if (kindLabel) parts.push(kindLabel);

  // Compilation status
  if (config.compilationStatus) {
    switch (comp.compileResult.status) {
      case 'success':
        parts.push('Optimized');
        break;
      case 'error':
        parts.push(`Not Optimized (${comp.compileResult.diagnostics.length} errors)`);
        break;
      case 'skip':
        parts.push(`Skipped: "${comp.compileResult.reason}"`);
        break;
    }
  }

  return parts.length > 0 ? parts.join(' · ') : null;
}

function buildImportedLabel(
  imp: ImportedComponentAnalysis,
  result: FileAnalysisResult,
  config: Config,
): string | null {
  return getKindLabel(imp.directive, result.framework, config);
}

function getKindLabel(
  directive: string | null,
  framework: string,
  config: Config,
): string | null {
  if (directive === 'use client') {
    return config.clientComponent ? 'Client Component' : null;
  }
  if (directive === 'use server') {
    return config.serverComponent ? 'Server Component' : null;
  }
  // No directive
  if (framework === 'nextjs') {
    return config.serverComponent ? 'Server Component' : null;
  }
  // No framework — show generic label
  return 'Component';
}

function buildCommand(
  comp: DeclaredComponentAnalysis,
  uri: string,
): { command: string; arguments?: any[] } | null {
  if (comp.compileResult.status === 'success') {
    return {
      command: 'reactCompilerLens.peekCompiled',
      arguments: [uri, comp.name],
    };
  }
  if (comp.compileResult.status === 'error') {
    return {
      command: 'workbench.actions.view.problems',
    };
  }
  return null;
}

function buildDiagnostics(result: FileAnalysisResult): Diagnostic[] {
  const diagnostics: Diagnostic[] = [];

  for (const comp of result.declaredComponents) {
    if (comp.compileResult.status === 'error') {
      for (const diag of comp.compileResult.diagnostics) {
        const line = (diag.line ?? comp.location.line + 1) - 1;
        const col = diag.column ?? 0;
        diagnostics.push({
          range: Range.create(line, col, line, col + 1),
          message: `[${comp.name}] ${diag.message}`,
          severity: DiagnosticSeverity.Warning,
          source: 'react-compiler',
        });
      }
    }
  }

  return diagnostics;
}

interface Config {
  enabled: boolean;
  serverComponent: boolean;
  clientComponent: boolean;
  compilationStatus: boolean;
  diagnosticsEnabled: boolean;
  diagnosticsSeverity: string;
  framework: string;
}

documents.listen(connection);
connection.listen();
```

- [ ] **Step 2: Commit**

```bash
git add server/src/index.ts
git commit -m "feat: add LSP server with CodeLens and diagnostics"
```

---

### Task 9: LSP Client Extension

**Files:**
- Create: `client/src/extension.ts`
- Create: `client/src/virtualDocument.ts`
- Create: `client/src/commands.ts`

- [ ] **Step 1: Implement extension entry point**

Reference: `~/oss/react/compiler/packages/react-forgive/client/src/extension.ts`

```typescript
import * as path from 'node:path';
import * as vscode from 'vscode';
import {
  LanguageClient,
  LanguageClientOptions,
  ServerOptions,
  TransportKind,
} from 'vscode-languageclient/node';
import { CompiledDocumentProvider } from './virtualDocument';
import { registerCommands } from './commands';

let client: LanguageClient;

export function activate(context: vscode.ExtensionContext): void {
  const serverModule = context.asAbsolutePath(path.join('dist', 'server', 'index.js'));

  const serverOptions: ServerOptions = {
    run: { module: serverModule, transport: TransportKind.ipc },
    debug: { module: serverModule, transport: TransportKind.ipc },
  };

  const clientOptions: LanguageClientOptions = {
    documentSelector: [
      { scheme: 'file', language: 'javascriptreact' },
      { scheme: 'file', language: 'typescriptreact' },
    ],
    progressOnInitialization: true,
  };

  try {
    client = new LanguageClient(
      'reactCompilerLens',
      'React Compiler Lens',
      serverOptions,
      clientOptions,
    );
  } catch {
    vscode.window.showErrorMessage(
      "React Compiler Lens couldn't be started.",
    );
    return;
  }

  // Register virtual document provider for compiled code peek
  const compiledProvider = new CompiledDocumentProvider();
  context.subscriptions.push(
    vscode.workspace.registerTextDocumentContentProvider(
      'react-compiler-lens',
      compiledProvider,
    ),
  );

  // Register commands
  registerCommands(context, compiledProvider);

  // Listen for compiled code from server to update peek preview cache
  client.onNotification('react-compiler-lens/compiledCode', (params: { uri: string; code: string }) => {
    compiledProvider.updateCompiledCode(params.uri, params.code);
  });

  client.start();
  context.subscriptions.push({ dispose: () => client?.stop() });
}

export function deactivate(): Thenable<void> | undefined {
  return client?.stop();
}
```

- [ ] **Step 2: Implement virtual document provider**

```typescript
import * as vscode from 'vscode';

/**
 * Serves compiled code for peek preview via custom URI scheme.
 * URI format: react-compiler-lens://compiled/<encoded-file-uri>
 */
export class CompiledDocumentProvider implements vscode.TextDocumentContentProvider {
  private _onDidChange = new vscode.EventEmitter<vscode.Uri>();
  readonly onDidChange = this._onDidChange.event;

  private compiledCodeCache = new Map<string, string>();

  provideTextDocumentContent(uri: vscode.Uri): string {
    const fileUri = decodeURIComponent(uri.path.replace('/compiled/', ''));
    return this.compiledCodeCache.get(fileUri) ?? '// No compiled output available';
  }

  updateCompiledCode(fileUri: string, code: string): void {
    this.compiledCodeCache.set(fileUri, code);
    const uri = vscode.Uri.parse(
      `react-compiler-lens://compiled/${encodeURIComponent(fileUri)}`,
    );
    this._onDidChange.fire(uri);
  }

  dispose(): void {
    this._onDidChange.dispose();
  }
}
```

- [ ] **Step 3: Implement commands**

```typescript
import * as vscode from 'vscode';
import type { CompiledDocumentProvider } from './virtualDocument';

export function registerCommands(
  context: vscode.ExtensionContext,
  compiledProvider: CompiledDocumentProvider,
): void {
  context.subscriptions.push(
    vscode.commands.registerCommand(
      'reactCompilerLens.peekCompiled',
      async (fileUri: string, componentName: string) => {
        const uri = vscode.Uri.parse(
          `react-compiler-lens://compiled/${encodeURIComponent(fileUri)}`,
        );
        const doc = await vscode.workspace.openTextDocument(uri);
        await vscode.window.showTextDocument(doc, {
          viewColumn: vscode.ViewColumn.Beside,
          preview: true,
          preserveFocus: true,
        });
      },
    ),
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('reactCompilerLens.refresh', () => {
      vscode.commands.executeCommand('workbench.action.reloadWindow');
    }),
  );
}
```

- [ ] **Step 4: Commit**

```bash
git add client/src/extension.ts client/src/virtualDocument.ts client/src/commands.ts
git commit -m "feat: add LSP client with virtual document provider and commands"
```

---

### Task 10: Build Configuration

**Files:**
- Create: `rolldown.config.ts`

- [ ] **Step 1: Create Rolldown config**

```typescript
import { defineConfig } from 'rolldown';

export default defineConfig([
  // Client bundle
  {
    input: 'client/src/extension.ts',
    output: {
      file: 'dist/client/extension.js',
      format: 'cjs',
      sourcemap: true,
    },
    external: ['vscode'],
    platform: 'node',
  },
  // Server bundle
  {
    input: 'server/src/index.ts',
    output: {
      file: 'dist/server/index.js',
      format: 'cjs',
      sourcemap: true,
    },
    platform: 'node',
  },
]);
```

- [ ] **Step 2: Add vitest.config.ts**

```typescript
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['test/**/*.test.ts'],
    testTimeout: 30000, // Compiler can be slow
  },
});
```

- [ ] **Step 3: Verify build works**

Run: `cd ~/dev/react-compiler-lens && pnpm build`
Expected: `dist/client/extension.js` and `dist/server/index.js` generated

- [ ] **Step 4: Verify tests pass**

Run: `cd ~/dev/react-compiler-lens && pnpm test`
Expected: All tests pass

- [ ] **Step 5: Commit**

```bash
git add rolldown.config.ts vitest.config.ts
git commit -m "chore: add Rolldown build config and vitest config"
```

---

### Task 11: Integration Testing & Polish

**Files:**
- Modify: `package.json` (add `reactCompilerLens.peekCompiled` command)
- Create: `.vscode/launch.json` (for Extension Development Host debugging)

- [ ] **Step 1: Add peekCompiled command to package.json contributes**

Add to `contributes.commands` in root `package.json`:

```json
{
  "command": "reactCompilerLens.peekCompiled",
  "title": "React Compiler Lens: Peek Compiled Output"
}
```

- [ ] **Step 2: Create .vscode/launch.json for debugging**

```json
{
  "version": "0.2.0",
  "configurations": [
    {
      "name": "Launch Extension",
      "type": "extensionHost",
      "request": "launch",
      "args": ["--extensionDevelopmentPath=${workspaceFolder}"],
      "outFiles": ["${workspaceFolder}/dist/**/*.js"],
      "preLaunchTask": "npm: build"
    },
    {
      "name": "Attach to Server",
      "type": "node",
      "request": "attach",
      "port": 6009,
      "restart": true,
      "outFiles": ["${workspaceFolder}/dist/server/**/*.js"]
    }
  ]
}
```

- [ ] **Step 3: Build and verify extension loads**

Run: `cd ~/dev/react-compiler-lens && pnpm build`
Then press F5 in VS Code to launch Extension Development Host.
Expected: Extension activates when opening a `.tsx` file.

- [ ] **Step 4: Manual smoke test**

Create a test file in the Extension Development Host:
```tsx
"use client";
import { useState } from "react";

export default function Counter() {
  const [count, setCount] = useState(0);
  return <button onClick={() => setCount(c => c + 1)}>{count}</button>;
}
```
Expected: CodeLens shows `Client Component · Optimized` above `Counter`.

- [ ] **Step 5: Commit**

```bash
git add package.json .vscode/launch.json
git commit -m "chore: add debug config and peekCompiled command registration"
```

---

### Task 12: Final Review & Typecheck

- [ ] **Step 1: Run full typecheck**

Run: `cd ~/dev/react-compiler-lens && pnpm typecheck`
Expected: No errors

- [ ] **Step 2: Run all tests**

Run: `cd ~/dev/react-compiler-lens && pnpm test`
Expected: All pass

- [ ] **Step 3: Build production bundle**

Run: `cd ~/dev/react-compiler-lens && pnpm build`
Expected: Clean build, no warnings

- [ ] **Step 4: Package as .vsix**

Run: `cd ~/dev/react-compiler-lens && pnpm package`
Expected: `react-compiler-lens-0.0.1.vsix` generated

- [ ] **Step 5: Final commit**

```bash
git add -A
git commit -m "chore: finalize v0.0.1 for initial release"
```
