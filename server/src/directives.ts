import type * as t from '@babel/types';
import type { Directive } from '@react-compiler-lens/shared';
import { type ParsedAst, parseCode, walkAst, isFunctionNode } from './ast';

function directiveValue(value: string): Directive {
  if (value === 'use client') return 'use client';
  if (value === 'use server') return 'use server';
  return null;
}

export function extractFileDirective(code: string, ast?: ParsedAst): Directive {
  const parsed = ast ?? parseCode(code);
  if (!parsed) return null;

  for (const directive of parsed.program.directives) {
    const result = directiveValue(directive.value.value);
    if (result !== null) return result;
  }

  return null;
}

export function extractFunctionDirectives(code: string, ast?: ParsedAst): Map<string, Directive> {
  const result = new Map<string, Directive>();
  const parsed = ast ?? parseCode(code);
  if (!parsed) return result;

  walkAst(parsed.program as unknown as t.Node, (node) => {
    if (!isFunctionNode(node)) return;

    if (node.body.type !== 'BlockStatement') return;

    const directives = (node.body as t.BlockStatement & { directives?: t.Directive[] }).directives;
    if (!directives?.length) return;

    let name: string | null = null;
    if ((node.type === 'FunctionDeclaration' || node.type === 'FunctionExpression') && node.id) {
      name = node.id.name;
    }
    if (!name) return;

    for (const directive of directives) {
      const d = directiveValue(directive.value.value);
      if (d !== null) result.set(name, d);
    }
  });

  return result;
}
