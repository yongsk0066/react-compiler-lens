/**
 * React function classification logic, ported from
 * babel-plugin-react-compiler's Program.ts.
 *
 * Classifies top-level functions as 'Component', 'Hook', or neither
 * using the same heuristics the React Compiler uses internally.
 */

import { traverse, type NodePath, type types as t } from '@babel/core';
import type { ParsedAst } from './ast';

export type ReactFunctionType = 'Component' | 'Hook';

/**
 * Traverse the AST and classify each function as Component, Hook, or neither.
 * Returns a map from function name to its classification.
 * Functions that are neither Component nor Hook are excluded.
 */
export function classifyFunctions(ast: ParsedAst): Map<string, ReactFunctionType> {
  const result = new Map<string, ReactFunctionType>();

  traverse(ast, {
    FunctionDeclaration(path) {
      classify(path, result);
    },
    FunctionExpression(path) {
      classify(path, result);
    },
    ArrowFunctionExpression(path) {
      classify(path, result);
    },
  });

  return result;
}

type BabelFn =
  | NodePath<t.FunctionDeclaration>
  | NodePath<t.FunctionExpression>
  | NodePath<t.ArrowFunctionExpression>;

function classify(path: BabelFn, result: Map<string, ReactFunctionType>): void {
  const fnType = getComponentOrHookLike(path);
  if (fnType === null) return;

  const namePath = getFunctionName(path);
  if (namePath === null) return;

  let name: string | null = null;
  if (namePath.isIdentifier()) {
    name = namePath.node.name;
  } else if (namePath.isMemberExpression()) {
    const prop = namePath.get('property');
    if (Array.isArray(prop)) return;
    if (prop.isIdentifier()) {
      name = prop.node.name;
    }
  }

  if (name) {
    result.set(name, fnType);
  }
}

// ---------------------------------------------------------------------------
// Functions below are ported from babel-plugin-react-compiler Program.ts
// ---------------------------------------------------------------------------

function isHookName(s: string): boolean {
  return /^use[A-Z0-9]/.test(s);
}

function isHook(path: NodePath<t.Expression | t.PrivateName>): boolean {
  if (path.isIdentifier()) {
    return isHookName(path.node.name);
  } else if (
    path.isMemberExpression() &&
    !path.node.computed &&
    isHook(path.get('property') as NodePath<t.Expression | t.PrivateName>)
  ) {
    const obj = path.get('object').node;
    const isPascalCaseNameSpace = /^[A-Z].*/;
    return obj.type === 'Identifier' && isPascalCaseNameSpace.test(obj.name);
  } else {
    return false;
  }
}

function isComponentName(path: NodePath<t.Expression>): boolean {
  return path.isIdentifier() && /^[A-Z]/.test(path.node.name);
}

function isReactAPI(
  path: NodePath<t.Expression | t.PrivateName | t.V8IntrinsicIdentifier>,
  functionName: string,
): boolean {
  const node = path.node;
  return (
    (node.type === 'Identifier' && node.name === functionName) ||
    (node.type === 'MemberExpression' &&
      node.object.type === 'Identifier' &&
      node.object.name === 'React' &&
      node.property.type === 'Identifier' &&
      node.property.name === functionName)
  );
}

function isForwardRefCallback(path: NodePath<t.Expression>): boolean {
  return !!(
    path.parentPath?.isCallExpression() &&
    path.parentPath.get('callee').isExpression() &&
    isReactAPI(
      path.parentPath.get('callee') as NodePath<t.Expression>,
      'forwardRef',
    )
  );
}

function isMemoCallback(path: NodePath<t.Expression>): boolean {
  return !!(
    path.parentPath?.isCallExpression() &&
    path.parentPath.get('callee').isExpression() &&
    isReactAPI(
      path.parentPath.get('callee') as NodePath<t.Expression>,
      'memo',
    )
  );
}

function isValidPropsAnnotation(
  annot: t.TypeAnnotation | t.TSTypeAnnotation | t.Noop | null | undefined,
): boolean {
  if (annot == null) {
    return true;
  } else if (annot.type === 'TSTypeAnnotation') {
    switch (annot.typeAnnotation.type) {
      case 'TSArrayType':
      case 'TSBigIntKeyword':
      case 'TSBooleanKeyword':
      case 'TSConstructorType':
      case 'TSFunctionType':
      case 'TSLiteralType':
      case 'TSNeverKeyword':
      case 'TSNumberKeyword':
      case 'TSStringKeyword':
      case 'TSSymbolKeyword':
      case 'TSTupleType':
        return false;
    }
    return true;
  } else if (annot.type === 'TypeAnnotation') {
    switch (annot.typeAnnotation.type) {
      case 'ArrayTypeAnnotation':
      case 'BooleanLiteralTypeAnnotation':
      case 'BooleanTypeAnnotation':
      case 'EmptyTypeAnnotation':
      case 'FunctionTypeAnnotation':
      case 'NumberLiteralTypeAnnotation':
      case 'NumberTypeAnnotation':
      case 'StringLiteralTypeAnnotation':
      case 'StringTypeAnnotation':
      case 'SymbolTypeAnnotation':
      case 'ThisTypeAnnotation':
      case 'TupleTypeAnnotation':
        return false;
    }
    return true;
  } else if (annot.type === 'Noop') {
    return true;
  }
  return true;
}

function isValidComponentParams(
  params: Array<NodePath<t.Identifier | t.Pattern | t.RestElement>>,
): boolean {
  if (params.length === 0) {
    return true;
  } else if (params.length > 0 && params.length <= 2) {
    if (!isValidPropsAnnotation((params[0].node as t.Identifier).typeAnnotation)) {
      return false;
    }

    if (params.length === 1) {
      return !params[0].isRestElement();
    } else if (params[1].isIdentifier()) {
      const { name } = params[1].node;
      return name.includes('ref') || name.includes('Ref');
    } else {
      return false;
    }
  }
  return false;
}

function skipNestedFunctions(
  node: BabelFn,
) {
  return (fn: BabelFn): void => {
    if (fn.node !== node.node) {
      fn.skip();
    }
  };
}

function callsHooksOrCreatesJsx(node: BabelFn): boolean {
  let invokesHooks = false;
  let createsJsx = false;

  node.traverse({
    JSX() {
      createsJsx = true;
    },
    CallExpression(call) {
      const callee = call.get('callee');
      if (callee.isExpression() && isHook(callee)) {
        invokesHooks = true;
      }
    },
    ArrowFunctionExpression: skipNestedFunctions(node),
    FunctionExpression: skipNestedFunctions(node),
    FunctionDeclaration: skipNestedFunctions(node),
  });

  return invokesHooks || createsJsx;
}

function isNonNode(node?: t.Expression | null): boolean {
  if (!node) {
    return true;
  }
  switch (node.type) {
    case 'ObjectExpression':
    case 'ArrowFunctionExpression':
    case 'FunctionExpression':
    case 'BigIntLiteral':
    case 'ClassExpression':
    case 'NewExpression':
      return true;
  }
  return false;
}

function returnsNonNode(node: BabelFn): boolean {
  let result = false;
  if (
    node.type === 'ArrowFunctionExpression' &&
    node.node.body.type !== 'BlockStatement'
  ) {
    result = isNonNode(node.node.body);
  }

  node.traverse({
    ReturnStatement(ret) {
      result = isNonNode(ret.node.argument);
    },
    ArrowFunctionExpression: skipNestedFunctions(node),
    FunctionExpression: skipNestedFunctions(node),
    FunctionDeclaration: skipNestedFunctions(node),
    ObjectMethod(path) { path.skip(); },
  });

  return result;
}

function getComponentOrHookLike(
  node: BabelFn,
): ReactFunctionType | null {
  const functionName = getFunctionName(node);

  if (functionName !== null && isComponentName(functionName)) {
    const isComponent =
      callsHooksOrCreatesJsx(node) &&
      isValidComponentParams(node.get('params') as Array<NodePath<t.Identifier | t.Pattern | t.RestElement>>) &&
      !returnsNonNode(node);
    return isComponent ? 'Component' : null;
  } else if (functionName !== null && isHook(functionName)) {
    return callsHooksOrCreatesJsx(node) ? 'Hook' : null;
  }

  if (node.isFunctionExpression() || node.isArrowFunctionExpression()) {
    if (isForwardRefCallback(node) || isMemoCallback(node)) {
      return callsHooksOrCreatesJsx(node) ? 'Component' : null;
    }
  }
  return null;
}

function getFunctionName(
  path: BabelFn,
): NodePath<t.Expression> | null {
  if (path.isFunctionDeclaration()) {
    const id = path.get('id');
    if (id.isIdentifier()) {
      return id;
    }
    return null;
  }
  let id: NodePath<t.LVal | t.Expression | t.PrivateName> | null = null;
  const parent = path.parentPath;
  if (parent?.isVariableDeclarator() && parent.get('init').node === path.node) {
    id = parent.get('id') as NodePath<t.LVal>;
  } else if (
    parent?.isAssignmentExpression() &&
    parent.get('right').node === path.node &&
    parent.get('operator') === '='
  ) {
    id = parent.get('left');
  } else if (
    parent?.isProperty() &&
    parent.get('value').node === path.node &&
    !parent.get('computed') &&
    (parent.get('key') as NodePath).isLVal()
  ) {
    id = parent.get('key') as NodePath<t.LVal>;
  } else if (
    parent?.isAssignmentPattern() &&
    parent.get('right').node === path.node &&
    !parent.get('computed')
  ) {
    id = parent.get('left');
  }
  if (id !== null && (id.isIdentifier() || id.isMemberExpression())) {
    return id as NodePath<t.Expression>;
  } else {
    return null;
  }
}
