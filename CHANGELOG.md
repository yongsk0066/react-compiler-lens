# Changelog

## 0.0.4 (2026-03-20)

- Only show Server/Client labels when directive is explicitly present
- Files without `"use client"` / `"use server"` no longer show misleading labels
- Declared components still show compilation status (Optimized / Not Optimized / Skipped)
- Use compiler classification for imported components (constants/types no longer show CodeLens)
- Add `classifyFunctions` test suite

## 0.0.3 (2026-03-20)

- Skip node_modules imports for Server/Client detection (prevents false positives like next/link)

## 0.0.2 (2026-03-20)

- Use React Compiler's actual classification logic (not PascalCase heuristic)
- Detect `forwardRef` / `memo` wrapped components
- CodeLens refresh after analysis (`workspace/codeLens/refresh`)
- Live settings sync without reload
- Error logging to Output channel
- Lightweight refresh command (no more window reload)
- Reduced .vsix size from 7MB to 2.5MB

## 0.0.1 (2026-03-20)

Initial release.

- CodeLens for Server/Client Component identification
- React Compiler compilation status (Optimized / Not Optimized / Skipped)
- Compiled output preview (side tab or peek view)
- Diagnostics in Problems panel for compilation errors
- Next.js framework auto-detection
- Import directive resolution with re-export chain following
