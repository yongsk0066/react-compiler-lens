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
    │     ├── babel-plugin-react-compiler → logger events + compiled code
    │     └── classifyFunctions (classify.ts) → Component / Hook classification
    ├── parseCode (ast.ts)
    │     └── @babel/parser → AST (shared across all consumers)
    ├── extractDirectives (directives.ts)
    │     └── file-level + function-level "use client" / "use server"
    ├── determineFileKind (analyzer.ts)
    │     └── directive + server-only import → FileKind classification
    ├── resolveImports (resolution.ts)
    │     └── TS module resolution → re-export chain → file classification cache
    └── buildReactiveValues (analyzer.ts)
          └── parse compiled output for cache dependencies
```

## Analysis Pipeline

1. **Document change** triggers `scheduleAnalysis` (200ms debounce)
2. **Content hash check** — skip if file hasn't changed
3. **compileFile** — Babel parse + React Compiler transform; logger captures per-function events
4. **classifyFunctions** — ported compiler logic identifies Component vs Hook vs Other
5. **AST reuse** — same parse for directives, imports, JSX locations
6. **FileKind detection** — combines directive + `server-only` import + framework context
7. **Import resolution** — `ts.resolveModuleName` + re-export chain following + component classification on source file
8. **Reactive values** — parsed from compiled output (cache dependency names)
9. **Cache + publish** — results stored by URI; diagnostics + codeLens/refresh sent to client

## Design Decisions

**React Compiler as single source of truth.**
We run the actual compiler and read its logger events. Component classification uses functions ported from the compiler's `Program.ts` — same logic for PascalCase + hooks/JSX + valid params + return type + forwardRef/memo detection.

**Single parse, multiple consumers.**
The compiler's Babel transform parses the file. That AST is reused for directive extraction, import analysis, and JSX location collection.

**Directive inheritance.**
A `"use client"` file's imports inherit the Client label when they have no directive of their own. Verified against Next.js webpack source — transitive dependencies of client boundaries are bundled as client code.

**node_modules skipped.**
External packages resolve to `.d.ts` which lacks directives. Analyzing them produces false positives. Only project-internal imports are classified.

**FileKind system.**
Files are classified beyond just directive: `client`, `server-action` (has "use server"), `server-only` (imports `server-only` package), `server-default` (no directive in Next.js), `unknown`.

## File Responsibilities

| File | Role |
|---|---|
| `server/src/index.ts` | LSP lifecycle, config (17 settings), caching, codeLens, diagnostics |
| `server/src/analyzer.ts` | Orchestrates compile + AST analysis → `FileAnalysisResult` |
| `server/src/compiler.ts` | Babel + React Compiler transform, event capture |
| `server/src/classify.ts` | Component/Hook classification (ported from compiler) |
| `server/src/directives.ts` | "use client" / "use server" extraction |
| `server/src/framework.ts` | Next.js detection by config file |
| `server/src/resolution.ts` | Import resolution + re-export chain + file classification cache |
| `server/src/ast.ts` | Babel parser wrapper, AST walker |
| `client/src/extension.ts` | LSP client, config sync |
| `client/src/commands.ts` | Commands: peek compiled, refresh, show problems |
| `shared/src/types.ts` | Shared types: FileKind, CompileResult, DiagnosticInfo, etc. |
