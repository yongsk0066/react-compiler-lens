# React Compiler Lens

VS Code extension that shows React Compiler analysis results as CodeLens annotations.

## Stack

TypeScript, LSP (vscode-languageserver), Babel, babel-plugin-react-compiler, Rolldown bundler, Vitest.

## Commands

```bash
pnpm build          # clean + rolldown bundle
pnpm typecheck      # tsc -b (project references)
pnpm test           # vitest run
pnpm package        # vsce package --no-dependencies
```

## Structure

```
client/src/
  extension.ts    — LSP client bootstrap
  commands.ts     — VS Code commands (peek compiled, refresh, show problems)
server/src/
  index.ts        — LSP server: config, caching, codeLens, diagnostics
  analyzer.ts     — Orchestrates compile + AST analysis per file
  compiler.ts     — Runs babel-plugin-react-compiler, captures logger events
  directives.ts   — Extracts "use client" / "use server" from file and function level
  framework.ts    — Detects Next.js by config file presence
  resolution.ts   — Resolves import directives via TS module resolution + re-export chain following
  ast.ts          — Babel parse + walk utilities
shared/src/
  types.ts        — Shared type definitions (FileAnalysisResult, CompileResult, etc.)
```

## Key Decisions

- Single Babel parse per file: compiler runs first, then AST is reused for directives/imports.
- React Compiler as SSOT: logger events are the ground truth for compilation status.
- Content hash caching: skip re-analysis when file content hasn't changed.
- LSP architecture: server runs in a separate process, communicates via IPC.
