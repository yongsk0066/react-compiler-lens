# Contributing

## Setup

```bash
git clone https://github.com/yongsk0066/react-compiler-lens.git
cd react-compiler-lens
pnpm install
```

## Development

```bash
pnpm build          # build client + server bundles
pnpm typecheck      # type check
pnpm test           # run tests
pnpm lint           # lint with oxlint
pnpm format         # format with oxfmt
```

Press F5 in VS Code to launch the Extension Development Host for manual testing.

## Pull Requests

- Run `pnpm lint && pnpm typecheck && pnpm test` before submitting
- Reference the related issue if one exists
- Keep changes focused — one concern per PR

## Architecture

See [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) for the analysis pipeline and design decisions.

## Code Style

See [docs/CODE_PHILOSOPHY.md](docs/CODE_PHILOSOPHY.md).
