# React Compiler Lens

VS Code extension that shows React Compiler analysis results as CodeLens annotations.

## Stack

TypeScript 6, LSP (vscode-languageserver), Babel, babel-plugin-react-compiler, Rolldown, Vitest, oxlint, oxfmt.

## Commands

```bash
pnpm build          # clean + rolldown bundle
pnpm typecheck      # tsc -b (project references)
pnpm test           # vitest run
pnpm lint           # oxlint
pnpm format         # oxfmt --write
pnpm package        # prepackage hook runs lint+typecheck+test+build first
```

## Release

```bash
npm version patch   # bumps version + creates git tag
git push && git push --tags  # GitHub Actions: test → build → marketplace publish
```

## Structure

```
client/src/
  extension.ts    — LSP client, config sync
  commands.ts     — peek compiled, refresh, show problems
server/src/
  index.ts        — LSP server: config, caching, codeLens, diagnostics
  analyzer.ts     — Orchestrates compile + AST analysis per file
  compiler.ts     — Babel + React Compiler, logger event capture
  classify.ts     — Component/Hook classification (ported from compiler source)
  directives.ts   — "use client" / "use server" extraction
  framework.ts    — Next.js detection
  resolution.ts   — Import resolution + re-export chain + file classification cache
  ast.ts          — Babel parse + walk utilities
shared/src/
  types.ts        — FileAnalysisResult, FileKind, CompileResult, etc.
```

## Key Decisions

- React Compiler as SSOT: logger events + ported classification logic.
- Single Babel parse per file: compiler runs first, AST reused for directives/imports.
- Content hash caching: skip re-analysis when content unchanged.
- Directive inheritance: "use client" propagates to imports without own directive.
- node_modules skipped: external packages not analyzed (prevents false positives).
- FileKind system: files classified as client/server-action/server-only/server-default/unknown.
