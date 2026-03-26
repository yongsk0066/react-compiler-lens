## Check Diagnostics

When a component can't be optimized, the **Problems panel** shows why.

Each diagnostic includes:
- **Error category** (e.g., `[Refs]`, `[Purity]`) — what rule was violated
- **Description** — detailed explanation of the issue
- **Hints** — suggestions for how to fix it
- **Related locations** — click to jump to relevant code

> **Common categories:**
> - **Refs** — accessing `ref.current` during render
> - **Purity** — calling `Date.now()` or `Math.random()` during render
> - **Hooks** — violating Rules of Hooks
