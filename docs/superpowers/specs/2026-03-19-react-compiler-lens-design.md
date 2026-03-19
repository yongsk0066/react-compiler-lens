# react-compiler-lens Design Spec

## Overview

A VS Code extension that uses the React Compiler (`babel-plugin-react-compiler`) as the single source of truth for component identification, displaying Server/Client component kind and compilation status via CodeLens annotations.

### Motivation

Existing tools (e.g., react-component-lens) rely on heuristic-based component detection (PascalCase naming, manual AST traversal). This extension delegates component identification to the React Compiler itself, which has a rigorous, well-tested classification pipeline (internally using `getReactFunctionType()`). Additionally, it leverages the compiler's fault tolerance feature and logger events to report compilation status per component.

### Prior Art

- **react-component-lens** — Heuristic-based Server/Client component decoration for VS Code. Limited to naming conventions and manual directive scanning.
- **react-forgive** (Meta) — Experimental LSP extension that shows "Optimized by React Compiler" CodeLens for successfully compiled functions. Only shows success, no failure details, no Server/Client distinction.

## Architecture

LSP-based client/server architecture, with the compiler running in a separate process to avoid blocking the editor.

```
┌───────────────────────────────────────────────────┐
│  VS Code Extension Host (Client)                   │
│                                                     │
│  ┌─────────────────┐  ┌────────────────────────┐   │
│  │ CodeLens Provider│  │ Diagnostics Renderer   │   │
│  │ (UI + click)     │  │ (Problems panel)       │   │
│  └────────┬─────────┘  └──────────┬────────────┘   │
│           └──────────┬────────────┘                  │
│           │  ┌───────▼───────────────────────┐      │
│           │  │ Virtual Document Provider      │      │
│           │  │ (compiled output for peek)     │      │
│           │  └───────────────────────────────┘      │
│                      │ LSP Protocol (IPC)            │
└──────────────────────┼───────────────────────────────┘
                       │
┌──────────────────────┼───────────────────────────────┐
│  LSP Server (separate process)                        │
│                      │                                │
│  ┌───────────────────▼──────────────────┐             │
│  │         Document Analyzer             │             │
│  │                                       │             │
│  │  1. Babel transform with              │             │
│  │     babel-plugin-react-compiler       │             │
│  │     + Logger event capture            │             │
│  │  2. program.directives                │             │
│  │     → "use client" / "use server"     │             │
│  │     (file-level and function-level)   │             │
│  │  3. Import resolution                 │             │
│  │     → source file directive lookup    │             │
│  │     → re-export chain resolution      │             │
│  └───────────────────┬──────────────────┘             │
│                      │                                │
│  ┌───────────────────▼──────────────────┐             │
│  │       Framework Detector              │             │
│  │       (next.config.* detection)       │             │
│  └──────────────────────────────────────┘             │
└───────────────────────────────────────────────────────┘
```

## Analysis Pipeline

When a file is opened or modified:

### Step 1: Babel Transform with React Compiler

Run `@babel/core` `transformFromAstAsync` with `babel-plugin-react-compiler` configured. This is the same approach react-forgive uses. The compiler internally calls `getReactFunctionType()` (a private API) to classify functions as Component/Hook/Other, then compiles eligible functions.

Configuration:
- `panicThreshold: 'none'` — fault tolerance, collect all errors instead of stopping at first
- A custom `logger` callback to capture all events per function

The compiled output string (`result.code`) is stored for peek preview on CodeLens click.

**Note:** `getReactFunctionType()` is not part of the public API. We do NOT call it directly. Instead, we run the full compilation pipeline and observe results through logger events. This maintains the SSOT principle — the compiler decides what is a component.

### Step 2: Logger Event Collection

The compiler emits structured `LoggerEvent`s during compilation. All seven variants are handled:

| Event | Maps to |
|-------|---------|
| `CompileSuccess` | Optimized — includes `memoSlots`, `memoBlocks`, `memoValues`, `prunedMemoBlocks`, `prunedMemoValues` |
| `CompileError` | Not Optimized — includes error diagnostics |
| `CompileSkip` | Skipped — includes reason (e.g., "use no memo") |
| `CompileDiagnostic` | Warning — surfaced in Problems panel |
| `CompileUnexpectedThrow` | Error — treated as compilation failure |
| `PipelineError` | Error — treated as compilation failure |
| `Timing` | Ignored (internal performance metric) |

Each event includes `fnLoc` (function source location) and `fnName` to map results back to specific functions.

### Step 3: Directive Extraction

Read `program.node.directives` from the parsed AST for file-level `"use client"` or `"use server"`.

Additionally, detect function-level `"use server"` directives (Server Actions). A function with `"use server"` in its body is a Server Action regardless of the file-level directive.

Precedence: explicit directive (file or function level) > framework-inferred default.

### Step 4: Import Resolution

Collect import statements, resolve file paths using TypeScript's `ts.resolveModuleName()` (respecting tsconfig/jsconfig path aliases), and check the source file's directive.

**Re-export chain resolution:** For barrel files (`export { Button } from './Button'`), follow the re-export chain to the original source file to determine the directive. Cache intermediate results.

Source file directives are cached in `Map<filePath, directive>` and only re-parsed when the file changes. Directive-only parsing is lightweight — only needs `@babel/parser` to read the AST directives, no full compilation.

### Step 5: Result Assembly

```typescript
interface FileAnalysisResult {
  filePath: string
  directive: 'use client' | 'use server' | null
  framework: 'nextjs' | 'none'
  declaredComponents: DeclaredComponentAnalysis[]
  importedComponents: ImportedComponentAnalysis[]
}

interface DeclaredComponentAnalysis {
  name: string
  location: { line: number; column: number }
  directive: 'use client' | 'use server' | null  // may differ from file-level for Server Actions
  compileResult:
    | { status: 'success'; compiledCode: string; memoSlots: number; memoBlocks: number; memoValues: number }
    | { status: 'error'; diagnostics: CompilerDiagnostic[] }
    | { status: 'skip'; reason: string }
}

interface ImportedComponentAnalysis {
  name: string
  importLocation: { line: number; column: number }
  jsxLocations: { line: number; column: number }[]
  directive: 'use client' | 'use server' | null
  sourceFilePath: string
}
```

## CodeLens Display

### Display Locations & Content

| Location | What is shown |
|----------|---------------|
| Import statement | Server/Client label |
| Component declaration | Server/Client label + compilation status |
| JSX tag usage | Server/Client label |

### Label Format

**Imported components (import + JSX tags):**
- `[Client Component]`
- `[Server Component]`
- `[Component]` — when framework is not detected and no directive

**Declared components:**
- `[Server Component · Optimized]` — compilation success
- `[Client Component · Not Optimized (N errors)]` — compilation failed
- `[Server Component · Skipped: "use no memo"]` — opted out

### Click Behavior

| State | Action |
|-------|--------|
| Optimized | `editor.action.peekLocations` showing compiled output via virtual document provider |
| Not Optimized | Focus Problems panel on this component's diagnostics |
| Skipped | No action |
| Import/JSX (no compile status) | No action |

**Virtual Document Provider:** Compiled output code is stored in memory per file. A `TextDocumentContentProvider` registered with a custom URI scheme (e.g., `react-compiler-lens://compiled/...`) serves the compiled code to peek views.

## Diagnostics

Compilation errors and diagnostics are published to the Problems panel via LSP `textDocument/publishDiagnostics`.

- `CompileError` → `Warning` severity (compilation failure doesn't break the app)
- `CompileDiagnostic` → `Information` severity
- `CompileUnexpectedThrow` / `PipelineError` → `Warning` severity

Format: source `react-compiler`, with function name and error detail.

## Framework Detection

On workspace open, scan for framework config files:

| File | Framework | Default behavior |
|------|-----------|-----------------|
| `next.config.js/ts/mjs` | Next.js | No directive → Server Component |
| (none detected) | None | No directive → `Component` (no Server/Client label) |

Cached per workspace. Re-detected only when config files change (file watcher).

Extensible structure for future frameworks (Remix, etc.).

## Configuration

```jsonc
{
  // Master toggle
  "reactCompilerLens.enabled": true,

  // CodeLens targets
  "reactCompilerLens.codeLens.serverComponent": true,
  "reactCompilerLens.codeLens.clientComponent": true,
  "reactCompilerLens.codeLens.compilationStatus": true,

  // Diagnostics
  "reactCompilerLens.diagnostics.enabled": true,
  "reactCompilerLens.diagnostics.severity": "warning",

  // Framework override
  "reactCompilerLens.framework": "auto"  // "auto" | "nextjs" | "none"
}
```

## Caching & Performance

### Debounce
200ms after document change before triggering analysis. Prevents excessive re-analysis during typing.

### Signature Cache
`Map<filePath, { signature: string; result: AnalysisResult }>` — skip re-analysis if document version + content hash unchanged.

### Directive Cache
`Map<filePath, directive>` — source file directives cached separately. Lightweight: only needs `@babel/parser` to read directives, no full compilation.

### File-level Granularity
Only the changed file is re-analyzed (full compilation). Other files' cached results remain valid. Import resolution re-checks directive cache but does not re-compile source files.

### LSP Process Isolation
Babel + React Compiler run in a separate Node.js process. Editor UI never blocks regardless of compilation cost.

### Framework Detection
Once per workspace open. Cached. Re-detected only on config file changes.

## Project Structure

```
~/dev/react-compiler-lens/
├── client/
│   └── src/
│       ├── extension.ts
│       ├── commands.ts
│       └── virtualDocument.ts
├── server/
│   └── src/
│       ├── index.ts
│       ├── analyzer.ts
│       ├── compiler.ts
│       ├── directives.ts
│       ├── resolution.ts
│       └── framework.ts
├── shared/
│   └── src/
│       └── types.ts
├── test/
│   ├── analyzer.test.ts
│   ├── compiler.test.ts
│   ├── directives.test.ts
│   ├── framework.test.ts
│   └── resolution.test.ts
├── package.json
├── tsconfig.json
├── rolldown.config.ts
└── pnpm-workspace.yaml
```

### Dependencies

| Package | Purpose |
|---------|---------|
| `vscode-languageclient` | Client LSP connection |
| `vscode-languageserver` | Server LSP implementation |
| `vscode-languageserver-textdocument` | Document sync |
| `@babel/core` | Babel transform pipeline (required for compiler integration) |
| `@babel/parser` | Lightweight directive-only parsing for imported files |
| `@babel/generator` | Code generation from compiled AST (for peek preview) |
| `babel-plugin-react-compiler` | Component identification + compilation |
| `typescript` | Type checking + `ts.resolveModuleName()` for import resolution |
| `rolldown` | Bundling (client + server) |
| `vitest` | Testing |

### Monorepo

pnpm workspace with three packages (client, server, shared) — client and server are separate bundles that share types.

## Deactivation & Disposal

On extension deactivation:
- Stop the LSP server process
- Dispose all file watchers (framework config, source files)
- Clear all caches (analysis, directive, framework)
- Dispose CodeLens provider and diagnostics collection
- Dispose virtual document provider

## Known Limitations

- **Class components** are not detected. The React Compiler only classifies function-based components. Class components (`extends React.Component`) will not appear in CodeLens.
- **Dynamic imports** (`React.lazy(() => import('./X'))`) are not resolved. Only static import statements are analyzed.
- **Nested component definitions** (components defined inside other components) may not appear in logger events depending on the compiler's compilation mode.
- **Parse failures** — if `@babel/parser` throws a syntax error, the file is silently skipped. No CodeLens or diagnostics are shown for unparseable files.

## Testing Strategy

### Test Scope

Test the analysis logic directly (no LSP protocol testing). All tests run in pure Node.js without VS Code.

### Test Structure

| File | Coverage |
|------|----------|
| `analyzer.test.ts` | Full pipeline: file text → analysis result |
| `compiler.test.ts` | React Compiler wrapper: success/failure/skip/unexpected throw |
| `directives.test.ts` | Directive extraction (file-level + function-level "use server") |
| `framework.test.ts` | next.config.* detection |
| `resolution.test.ts` | Import resolve → source file directive (including re-exports) |

### Key Test Cases

- `"use client"` file → all components are Client
- `"use server"` file → all components are Server
- Function-level `"use server"` → that function is Server Action
- No directive + Next.js detected → Server
- No directive + no framework → no Server/Client label
- Explicit directive takes precedence over framework default
- Imported component inherits source file's directive
- Re-exported component follows chain to original source directive
- JSX tag locations correctly mapped
- All LoggerEvent variants handled (Success, Error, Skip, Diagnostic, UnexpectedThrow, PipelineError)
- Compilation success → Optimized + compiled code string available
- Compilation failure with fault tolerance → all errors collected
- `"use no memo"` → Skipped with reason
- Regular functions and Hooks → not in CodeLens results
- Unparseable file → graceful skip, no crash
- Temporary directory-based test fixtures (following react-component-lens pattern)

## Tech Stack

- **Language:** TypeScript
- **Bundler:** Rolldown
- **Package Manager:** pnpm
- **Test Runner:** vitest
- **Target:** VS Code 1.96.0+
- **Activation:** `onLanguage:typescriptreact`, `onLanguage:javascriptreact`
