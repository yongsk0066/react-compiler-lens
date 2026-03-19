import type * as t from '@babel/types';
import type { Directive } from '@react-compiler-lens/shared';
import { parseCode, walkAst } from './ast';

function directiveValue(value: string): Directive {
  if (value === 'use client') return 'use client';
  if (value === 'use server') return 'use server';
  return null;
}

/**
 * Extracts the file-level directive (`"use client"` or `"use server"`)
 * from the top of the file. Returns `null` if no matching directive is found.
 */
export function extractFileDirective(code: string): Directive {
  const ast = parseCode(code);
  if (!ast) return null;

  for (const directive of ast.program.directives) {
    const result = directiveValue(directive.value.value);
    if (result !== null) return result;
  }

  return null;
}

/**
 * Traverses the AST and collects function-level directives (e.g., `"use server"`
 * inside a function body). Returns a Map of function name → directive.
 */
export function extractFunctionDirectives(code: string): Map<string, Directive> {
  const result = new Map<string, Directive>();
  const ast = parseCode(code);
  if (!ast) return result;

  walkAst(ast.program as unknown as t.Node, (node) => {
    const isFn = node.type === 'FunctionDeclaration'
      || node.type === 'FunctionExpression'
      || node.type === 'ArrowFunctionExpression';
    if (!isFn) return;

    const fn = node as t.FunctionDeclaration | t.FunctionExpression | t.ArrowFunctionExpression;
    if (fn.body.type !== 'BlockStatement') return;

    const directives = (fn.body as t.BlockStatement & { directives?: t.Directive[] }).directives;
    if (!directives?.length) return;

    // Resolve function name
    let name: string | null = null;
    if ((fn.type === 'FunctionDeclaration' || fn.type === 'FunctionExpression') && fn.id) {
      name = fn.id.name;
    }
    if (!name) return;

    for (const directive of directives) {
      const d = directiveValue(directive.value.value);
      if (d !== null) result.set(name, d);
    }
  });

  return result;
}
