import * as parser from '@babel/parser';
import type * as t from '@babel/types';

export type ParsedAst = parser.ParseResult<t.File>;

export function parseCode(code: string): ParsedAst | null {
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

export function isFunctionNode(node: t.Node): node is t.FunctionDeclaration | t.FunctionExpression | t.ArrowFunctionExpression {
  return node.type === 'FunctionDeclaration'
    || node.type === 'FunctionExpression'
    || node.type === 'ArrowFunctionExpression';
}
