# Changelog

## 0.0.7 (2026-03-26)

### Performance
- Eliminate data race on `reactiveValuesMap` (moved to local variable)
- Reduce Babel parsing from 3x to 1x per file (AST reuse from compiler)
- Bound `ImportResolver.fileCache` to 500 entries (FIFO eviction)
- Cache re-export chain resolution results
- Prevent concurrent analysis for same file (in-flight guard)
- Add 10s compile timeout to prevent LSP blocking

### Security
- Pin all GitHub Actions to immutable commit SHAs
- Add `permissions: contents: read` to CI workflow
- Use `pnpm install --frozen-lockfile` in CI
- Add workspace boundary check in import resolution
- Hidden sourcemaps (no dangling references in shipped JS)

### Testing
- Extract LSP server pure functions to `labels.ts` (testable)
- 112 tests (was 87) — labels, edge cases, deterministic bailout diagnostics

### Marketplace
- Categories: Linters + Visualization
- Keywords expanded to 15
- Gallery banner, badges
- README restructured for marketplace (badges, tagline, Quick Start, collapsible settings)
- Getting Started walkthrough

### Contributor Experience
- CONTRIBUTING.md, CODE_OF_CONDUCT.md, SECURITY.md
- Issue templates (bug report, feature request)
- Pull request template
- Dependabot for GitHub Actions
- .editorconfig, .node-version

## 0.0.6 (2026-03-26)

- FileKind system: classify files as client, server-action, server-only, server-default
- Rich diagnostics: error category, description, and related source locations in Problems panel
- Reactive values: show tracked dependencies in Optimized CodeLens
- 6 new settings: reactive values, JSX lens, inherited suffix, diagnostics verbosity
- TypeScript 6.0.2, rolldown 1.0.0-rc.12
- oxlint + oxfmt for linting and formatting
- CI/CD: GitHub Actions for PR testing and tag-based marketplace publishing
- Dependabot for automated dependency updates
- prepackage safety hook

## 0.0.5 (2026-03-20)

- FileKind-aware component labeling (server-action, server-only detection)
- Server Action export detection
- `server-only` import detection
- Settings: serverAction, serverOnly, showDefaultSuffix

## 0.0.4 (2026-03-20)

- Directive inheritance: `"use client"` file's imports show "Client Component (inherited)"
- Only show Server/Client labels when directive is explicitly present or inherited
- Use React Compiler classification for imported components

## 0.0.3 (2026-03-20)

- Skip node_modules imports for Server/Client detection

## 0.0.2 (2026-03-20)

- React Compiler's actual classification logic (not PascalCase heuristic)
- CodeLens refresh after analysis
- Live settings sync, error logging, lightweight refresh command
- Reduced .vsix size from 7MB to 2.5MB

## 0.0.1 (2026-03-20)

Initial release.
