# React Compiler Lens

[![Version](https://img.shields.io/visual-studio-marketplace/v/yongsk0066.react-compiler-lens)](https://marketplace.visualstudio.com/items?itemName=yongsk0066.react-compiler-lens)
[![Installs](https://img.shields.io/visual-studio-marketplace/i/yongsk0066.react-compiler-lens)](https://marketplace.visualstudio.com/items?itemName=yongsk0066.react-compiler-lens)
[![License](https://img.shields.io/github/license/yongsk0066/react-compiler-lens)](LICENSE)

> See what the React Compiler sees — inline, as you code.

![CodeLens showing Client Component labels with directive inheritance](https://github.com/user-attachments/assets/1e8b0a8e-30b5-4408-b10f-0f97f29e7611)

![Compilation error inline diagnostic](https://github.com/user-attachments/assets/a8c72d20-56a3-4dc8-b44f-a172349c8cd0)

## Features

- **Server / Client Component labels** on declarations, imports, and JSX usage — resolves `"use client"` through re-export chains and barrel files
- **Directive inheritance** — imports in a `"use client"` file show "Client Component (inherited)"
- **Compilation status** — Optimized, Not Optimized (with error count and category), or Skipped (with reason)
- **Reactive values** — shows which dependencies the compiler tracks (`Optimized · reactive: count, items`)
- **Rich diagnostics** — compilation errors with category, description, and related source locations in the Problems panel
- **Compiled output preview** — click the CodeLens to see what the compiler produces (side tab or peek view)
- **FileKind detection** — classifies files as client, server-action, server-only, or server-default
- **Next.js auto-detection** — detects `next.config.*` for framework-aware labeling
- **React Compiler classification** — uses the compiler's own logic to identify components (not just PascalCase)

## Quick Start

1. Install from the [VS Code Marketplace](https://marketplace.visualstudio.com/items?itemName=yongsk0066.react-compiler-lens)
2. Open any `.tsx` or `.jsx` file in a React project
3. CodeLens annotations appear automatically

## How It Works

The extension runs an LSP server that invokes `babel-plugin-react-compiler` on each file. The compiler's logger events tell us exactly which functions were compiled, skipped, or rejected. Component classification uses the same logic the React Compiler uses internally — not just naming conventions.

Results are cached by content hash and debounced at 200ms.

## Settings

<details>
<summary>All settings (17 options)</summary>

All settings are under the `reactCompilerLens` namespace.

| Setting | Default | Description |
|---|---|---|
| `enabled` | `true` | Enable/disable the extension |
| `codeLens.serverComponent` | `true` | Show CodeLens for Server Components |
| `codeLens.clientComponent` | `true` | Show CodeLens for Client Components |
| `codeLens.compilationStatus` | `true` | Show compilation status |
| `codeLens.serverAction` | `true` | Show CodeLens for Server Actions |
| `codeLens.serverOnly` | `true` | Show CodeLens for server-only files |
| `codeLens.reactiveValues` | `true` | Show reactive dependency names |
| `codeLens.reactiveValuesMaxDisplay` | `3` | Max reactive values before truncating |
| `codeLens.importedComponentJsxLens` | `true` | Show labels at JSX usage sites |
| `codeLens.showInheritedSuffix` | `true` | Show "(inherited)" on inherited labels |
| `codeLens.showDefaultSuffix` | `true` | Show "(default)" for implicit Server Components |
| `diagnostics.enabled` | `true` | Show errors in Problems panel |
| `diagnostics.severity` | `"warning"` | Severity: `warning`, `error`, or `info` |
| `diagnostics.showDescription` | `true` | Include extended description |
| `diagnostics.showRelatedLocations` | `true` | Show related source locations |
| `framework` | `"auto"` | Framework detection: `auto`, `nextjs`, or `none` |
| `compiledOutput.viewMode` | `"side"` | Display mode: `side` or `peek` |

</details>

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md).

## License

MIT
