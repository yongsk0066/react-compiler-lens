import * as parser from '@babel/parser';
import type * as t from '@babel/types';

/**
 * Parse TypeScript/JSX source code into a Babel AST.
 * Returns null on parse failure (graceful degradation).
 */
export function parseCode(code: string): parser.ParseResult<t.File> | null {
  try {
    return parser.parse(code, {
      sourceType: 'module',
      errorRecovery: true,
      plugins: ['jsx', 'typescript'],
    });
  } catch {
    return null;
  }
}

/**
 * Walk all nodes in a Babel AST, calling the visitor for each.
 */
export function walkAst(node: t.Node, visitor: (node: t.Node) => void): void {
  visitor(node);
  for (const key of Object.keys(node)) {
    const child = (node as unknown as Record<string, unknown>)[key];
    if (!child || typeof child !== 'object') continue;
    if (Array.isArray(child)) {
      for (const item of child) {
        if (item && typeof item === 'object' && 'type' in item) {
          walkAst(item as t.Node, visitor);
        }
      }
    } else if ('type' in child) {
      walkAst(child as t.Node, visitor);
    }
  }
}

/**
 * Check if a name is a React component (PascalCase, not a hook).
 */
export function isComponentName(name: string): boolean {
  if (/^use[A-Z0-9]/.test(name)) return false;
  return /^[A-Z]/.test(name);
}
