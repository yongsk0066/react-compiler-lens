# Changelog

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
