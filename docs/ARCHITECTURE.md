# Architecture

## Overview

```
VS Code Client (extension.ts, commands.ts)
    │  IPC (LSP protocol)
    ▼
LSP Server (index.ts)
    │  scheduleAnalysis → debounce → runAnalysis
    ▼
Analyzer (analyzer.ts)
    ├── compileFile (compiler.ts)
    │     └── babel-plugin-react-compiler → logger events + compiled code
    ├── parseCode (ast.ts)
    │     └── @babel/parser → AST
    ├── extractDirectives (directives.ts)
    │     └── file-level + function-level "use client" / "use server"
    └── resolveImports (resolution.ts)
          └── TS module resolution → re-export chain following
```

## Analysis Pipeline

1. **Document change** triggers `scheduleAnalysis` (200ms debounce)
2. **Content hash check** — skip if file hasn't changed
3. **compileFile** — Babel parse + React Compiler transform in one pass; logger captures per-function events (success/skip/error)
4. **AST reuse** — same Babel parse for directive extraction and import collection
5. **Import resolution** — TypeScript's `resolveModuleName` finds source files; `followReExportChain` walks barrel exports
6. **Cache + publish** — results stored by URI; diagnostics sent to client; `codeLens/refresh` triggers UI update

## Design Decisions

**React Compiler as single source of truth.**
Instead of heuristics, we run the actual compiler and read its logger events. This means the CodeLens status exactly matches what the compiler would do in a real build. No false positives.

**Single parse, multiple consumers.**
The compiler's Babel transform already parses the file. We reuse that AST for directive extraction and import analysis. This avoids parsing the same file twice.

**LSP over decoration API.**
CodeLens via LSP gives us a standard protocol that works across editors. The server runs in a separate process, so a slow compilation doesn't freeze the editor. Diagnostics integrate with the Problems panel for free.

**Re-export chain following.**
When `import { Button } from "./components"` points to a barrel file, we can't stop at the barrel — we follow named and star re-exports until we find the file with `"use client"`. Cycle detection prevents infinite loops.

## File Responsibilities

| File | Role |
|---|---|
| `server/src/index.ts` | LSP lifecycle, config, caching, codeLens construction, diagnostics publishing |
| `server/src/analyzer.ts` | Orchestrates compile + AST analysis into `FileAnalysisResult` |
| `server/src/compiler.ts` | Babel parse + React Compiler transform, event capture |
| `server/src/directives.ts` | Extract `"use client"` / `"use server"` from AST directives |
| `server/src/framework.ts` | Detect Next.js by checking for `next.config.*` |
| `server/src/resolution.ts` | TS module resolution + re-export chain following for import directives |
| `server/src/ast.ts` | Babel parser wrapper, AST walker, utility predicates |
| `client/src/extension.ts` | LSP client bootstrap, document selector, config sync |
| `client/src/commands.ts` | Command handlers: peek compiled output, refresh, show problems |
| `shared/src/types.ts` | Type definitions shared between client and server |
