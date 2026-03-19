# React Compiler Lens

CodeLens annotations for React components — powered by the React Compiler itself.

![CodeLens showing Client Component labels with directive inheritance](https://github.com/user-attachments/assets/1e8b0a8e-30b5-4408-b10f-0f97f29e7611)

![Compilation error inline diagnostic](https://github.com/user-attachments/assets/a8c72d20-56a3-4dc8-b44f-a172349c8cd0)

[Demo video](https://github.com/yongsk0066/react-compiler-lens/releases/download/v0.0.1/demo.mp4)

## Why

The React Compiler decides which components get optimized. But that decision is invisible until you check the build output. You can't tell from the source whether a component was memoized, skipped, or rejected.

React Compiler Lens runs the compiler in the background and shows the result inline, right where you write the code.

## Features

- **Server / Client Component labels** on declarations, imports, and JSX usage (resolves `"use client"` through re-export chains)
- **Compilation status** — Optimized, Not Optimized (with error count), or Skipped (with reason)
- **Compiled output preview** — click the CodeLens to see what the compiler produces (side tab or peek view)
- **Diagnostics** — compilation errors surface in the Problems panel
- **Next.js auto-detection** — files without a directive are treated as Server Components when `next.config.*` is present

## Install

Search **React Compiler Lens** in the VS Code Marketplace, or install from `.vsix`:

```
code --install-extension react-compiler-lens-0.0.1.vsix
```

## Settings

| Setting | Default | Description |
|---|---|---|
| `reactCompilerLens.enabled` | `true` | Enable/disable the extension |
| `reactCompilerLens.codeLens.serverComponent` | `true` | Show CodeLens for Server Components |
| `reactCompilerLens.codeLens.clientComponent` | `true` | Show CodeLens for Client Components |
| `reactCompilerLens.codeLens.compilationStatus` | `true` | Show compilation status in CodeLens |
| `reactCompilerLens.diagnostics.enabled` | `true` | Show compilation errors in Problems panel |
| `reactCompilerLens.diagnostics.severity` | `"warning"` | Severity level: `warning`, `error`, or `info` |
| `reactCompilerLens.framework` | `"auto"` | Framework detection: `auto`, `nextjs`, or `none` |
| `reactCompilerLens.compiledOutput.viewMode` | `"side"` | How to display compiled output: `side` or `peek` |

## Commands

| Command | Description |
|---|---|
| `React Compiler Lens: Refresh` | Clear caches and re-analyze all open files |
| `React Compiler Lens: Peek Compiled Output` | Show compiled output for a component |

## How It Works

The extension runs an LSP server that invokes `babel-plugin-react-compiler` on each file. The compiler's logger events tell us exactly which functions were compiled, skipped, or rejected. We reuse the same Babel parse for both compilation and AST analysis (directive extraction, import resolution, JSX usage).

Results are cached by content hash and debounced at 200ms to avoid redundant work during rapid edits.

## License

MIT
