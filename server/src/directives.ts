import * as parser from '@babel/parser';
import * as babel from '@babel/core';
import type { NodePath } from '@babel/core';
import type * as t from '@babel/types';
import type { Directive } from '@react-compiler-lens/shared';

function parseCode(code: string): parser.ParseResult<t.File> | null {
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

  try {
    babel.traverse(ast, {
      'FunctionDeclaration|FunctionExpression|ArrowFunctionExpression'(path: NodePath) {
        const node = path.node as babel.types.Function & {
          body: babel.types.BlockStatement & {
            directives?: t.File['program']['directives'];
          };
        };

        if (node.body.type !== 'BlockStatement') return;
        const directives = node.body.directives;
        if (!directives || directives.length === 0) return;

        for (const directive of directives) {
          const directiveResult = directiveValue(directive.value.value);
          if (directiveResult !== null) {
            let name: string | null = null;

            if (path.isFunctionDeclaration() && path.node.id) {
              name = path.node.id.name;
            } else if (path.isFunctionExpression() && path.node.id) {
              name = path.node.id.name;
            } else {
              const parent = path.parent;
              if (
                parent &&
                parent.type === 'VariableDeclarator' &&
                parent.id.type === 'Identifier'
              ) {
                name = (parent.id as babel.types.Identifier).name;
              }
            }

            if (name) {
              result.set(name, directiveResult);
            }
          }
        }
      },
    });
  } catch {
    // Gracefully handle traversal failures
  }

  return result;
}
