# Changelog

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
