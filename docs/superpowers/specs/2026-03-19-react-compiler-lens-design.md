# react-compiler-lens Design Spec

## Overview

A VS Code extension that uses the React Compiler (`babel-plugin-react-compiler`) as the single source of truth for component identification, displaying Server/Client component kind and compilation status via CodeLens annotations.

### Motivation

Existing tools (e.g., react-component-lens) rely on heuristic-based component detection (PascalCase naming, manual AST traversal). This extension delegates component identification to the React Compiler itself, which has a rigorous, well-tested classification pipeline (`getReactFunctionType()`). Additionally, it leverages the compiler's fault tolerance feature and logger events to report compilation status per component.

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
│                      │ LSP Protocol (IPC)            │
└──────────────────────┼───────────────────────────────┘
                       │
┌──────────────────────┼───────────────────────────────┐
│  LSP Server (separate process)                        │
│                      │                                │
│  ┌───────────────────▼──────────────────┐             │
│  │         Document Analyzer             │             │
│  │                                       │             │
│  │  1. Babel parse → AST                 │             │
│  │  2. program.directives                │             │
│  │     → "use client" / "use server"     │             │
│  │  3. getReactFunctionType()            │             │
│  │     → Component / Hook / Other        │             │
│  │  4. compileFn() + Logger events       │             │
│  │     → Success / Error / Skip          │             │
│  │  5. Import resolution                 │             │
│  │     → source file directive lookup    │             │
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

### Step 1: Babel Parse

Parse the file with `@babel/parser` (jsx + typescript plugins) to produce an AST.

### Step 2: Directive Extraction

Read `program.node.directives` for `"use client"` or `"use server"`. This is the file-level directive that applies to all components in the file.

### Step 3: Component Identification

Traverse the AST and call `getReactFunctionType()` on each function. This classifies functions as:
- `Component` — React component (PascalCase + hooks/JSX usage + valid params)
- `Hook` — React hook (use* naming + hooks/JSX usage)
- `Other` — Regular function

Only `Component` functions are targets for CodeLens.

### Step 4: Compilation (declared components only)

For each Component declared in the current file, run `compileFn()` with:
- `panicThreshold: 'none'` — fault tolerance, collect all errors
- A `logger` callback to capture `CompileSuccess`, `CompileError`, `CompileSkip` events

### Step 5: Import Resolution (imported components)

Collect import statements, resolve file paths (respecting tsconfig path aliases), and check the source file's directive. Source file directives are cached in `Map<filePath, directive>` and only re-parsed when the file changes.

### Step 6: Result Assembly

Per-function result:
```typescript
interface ComponentAnalysis {
  name: string
  location: { line: number; column: number }
  reactType: 'Component'
  directive: 'use client' | 'use server' | null
  // Only for declared components:
  compileResult?:
    | { status: 'success'; compiledCode: string; memoStats: MemoStats }
    | { status: 'error'; diagnostics: CompilerDiagnostic[] }
    | { status: 'skip'; reason: string }
}

interface ImportedComponentAnalysis {
  name: string
  location: { line: number; column: number }  // import statement location
  jsxLocations: { line: number; column: number }[]  // JSX tag locations
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
| Optimized | `editor.action.peekLocations` showing compiled output code |
| Not Optimized | Focus Problems panel on this component's diagnostics |
| Skipped | No action |
| Import/JSX (no compile status) | No action |

## Diagnostics

Compilation errors are always published to the Problems panel as `Warning` severity (compilation failure doesn't break the app).

Format: `react-compiler` source, with function name and error detail.

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
Only the changed file is re-analyzed. Other files' cached results remain valid.

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
│       └── commands.ts
├── server/
│   └── src/
│       ├── index.ts
│       ├── analyzer.ts
│       ├── compiler.ts
│       ├── directives.ts
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
| `@babel/core` | AST parsing & transformation |
| `@babel/parser` | JSX/TypeScript parsing |
| `babel-plugin-react-compiler` | Component identification + compilation |
| `rolldown` | Bundling (client + server) |
| `typescript` | Type checking |
| `vitest` | Testing |

### Monorepo

pnpm workspace with three packages (client, server, shared) — client and server are separate bundles that share types.

## Testing Strategy

### Test Scope

Test the analysis logic directly (no LSP protocol testing). All tests run in pure Node.js without VS Code.

### Test Structure

| File | Coverage |
|------|----------|
| `analyzer.test.ts` | Full pipeline: file text → analysis result |
| `compiler.test.ts` | React Compiler wrapper: success/failure/skip |
| `directives.test.ts` | Directive extraction from AST |
| `framework.test.ts` | next.config.* detection |
| `resolution.test.ts` | Import resolve → source file directive |

### Key Test Cases

- `"use client"` file → all components are Client
- `"use server"` file → all components are Server
- No directive + Next.js detected → Server
- No directive + no framework → no Server/Client label
- Imported component inherits source file's directive
- JSX tag locations correctly mapped
- Compilation success → Optimized + compiled code available
- Compilation failure → all errors collected (fault tolerance)
- `"use no memo"` → Skipped with reason
- Regular functions and Hooks → not in CodeLens results
- Temporary directory-based test fixtures (following react-component-lens pattern)

## Tech Stack

- **Language:** TypeScript
- **Bundler:** Rolldown
- **Package Manager:** pnpm
- **Test Runner:** vitest
- **Target:** VS Code 1.96.0+
- **Activation:** `onLanguage:typescriptreact`, `onLanguage:javascriptreact`
