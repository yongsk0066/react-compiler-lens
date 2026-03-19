import { parseAsync, transformFromAstAsync } from '@babel/core';
import type * as t from '@babel/types';
import type { LoggerEvent, PluginOptions } from 'babel-plugin-react-compiler';

export interface CapturedEvent {
  kind: string;
  fnLoc: t.SourceLocation | null;
  fnName: string | null;
  raw: LoggerEvent;
}

export interface CompileFileResult {
  events: CapturedEvent[];
  compiledCode: string | null;
  getComponentEvents(): CapturedEvent[];
}

function locKey(loc: t.SourceLocation): string {
  return `${loc.start.line}:${loc.start.column}-${loc.end.line}:${loc.end.column}`;
}

function isComponentName(name: string): boolean {
  // PascalCase and not a hook (hooks start with use followed by uppercase/digit)
  if (/^use[A-Z0-9]/.test(name)) return false;
  return /^[A-Z]/.test(name);
}

export async function compileFile(
  code: string,
  filename: string,
): Promise<CompileFileResult> {
  const sourceFileName = filename;

  // Step 1: Parse the code into an AST
  let ast: Awaited<ReturnType<typeof parseAsync>>;
  try {
    ast = await parseAsync(code, {
      sourceFileName,
      parserOpts: { plugins: ['typescript', 'jsx'] },
      sourceType: 'module',
      configFile: false,
      babelrc: false,
    });
  } catch {
    return {
      events: [],
      compiledCode: null,
      getComponentEvents: () => [],
    };
  }

  if (!ast) {
    return {
      events: [],
      compiledCode: null,
      getComponentEvents: () => [],
    };
  }

  // Step 2: Build dual location maps by traversing the AST
  // fnLocNames: node.loc → name  (used by most events)
  // bodyLocNames: node.body.loc → name  (used by CompileSkip)
  const fnLocNames = new Map<string, string>();
  const bodyLocNames = new Map<string, string>();

  function collectFnNames(node: t.Node): void {
    if (
      node.type === 'FunctionDeclaration' ||
      node.type === 'FunctionExpression' ||
      node.type === 'ArrowFunctionExpression'
    ) {
      const fn = node as t.FunctionDeclaration | t.FunctionExpression | t.ArrowFunctionExpression;
      let name: string | null = null;

      if (fn.type === 'FunctionDeclaration' && fn.id) {
        name = fn.id.name;
      } else if (fn.type === 'FunctionExpression' && fn.id) {
        name = fn.id.name;
      }

      if (name && fn.loc) {
        fnLocNames.set(locKey(fn.loc), name);
      }

      if (fn.body && fn.body.type === 'BlockStatement' && fn.body.loc && name) {
        bodyLocNames.set(locKey(fn.body.loc), name);
      }
    }

    // Recurse into child nodes
    for (const key of Object.keys(node)) {
      const child = (node as unknown as Record<string, unknown>)[key];
      if (child && typeof child === 'object') {
        if (Array.isArray(child)) {
          for (const item of child) {
            if (item && typeof item === 'object' && 'type' in item) {
              collectFnNames(item as t.Node);
            }
          }
        } else if ('type' in child) {
          collectFnNames(child as t.Node);
        }
      }
    }
  }

  // Also collect variable declarator → function assignments, e.g. const Foo = () => {}
  function collectVariableDeclarators(node: t.Node, parentName?: string): void {
    if (node.type === 'VariableDeclarator') {
      const decl = node as t.VariableDeclarator;
      if (
        decl.id.type === 'Identifier' &&
        decl.init &&
        (decl.init.type === 'FunctionExpression' || decl.init.type === 'ArrowFunctionExpression')
      ) {
        const name = (decl.id as t.Identifier).name;
        const fn = decl.init as t.FunctionExpression | t.ArrowFunctionExpression;
        if (fn.loc) {
          fnLocNames.set(locKey(fn.loc), name);
        }
        if (fn.body && fn.body.type === 'BlockStatement' && fn.body.loc) {
          bodyLocNames.set(locKey(fn.body.loc), name);
        }
      }
    }

    for (const key of Object.keys(node)) {
      if (key === 'type') continue;
      const child = (node as unknown as Record<string, unknown>)[key];
      if (child && typeof child === 'object') {
        if (Array.isArray(child)) {
          for (const item of child) {
            if (item && typeof item === 'object' && 'type' in item) {
              collectVariableDeclarators(item as t.Node);
            }
          }
        } else if ('type' in child) {
          collectVariableDeclarators(child as t.Node);
        }
      }
    }
  }

  collectFnNames(ast as unknown as t.Node);
  collectVariableDeclarators(ast as unknown as t.Node);

  // Step 3: Run babel-plugin-react-compiler and capture logger events
  const capturedEvents: CapturedEvent[] = [];

  const BabelPluginReactCompiler =
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ((await import('babel-plugin-react-compiler')) as any).default ??
    (await import('babel-plugin-react-compiler'));

  const options: Partial<PluginOptions> = {
    panicThreshold: 'none',
    logger: {
      logEvent(_filename: string | null, event: LoggerEvent) {
        // Resolve the function name from location maps
        let fnName: string | null = null;

        // CompileSuccess events already have fnName
        if (event.kind === 'CompileSuccess' && event.fnName) {
          fnName = event.fnName;
        } else if (event.kind !== 'Timing') {
          // For events with fnLoc, try fnLocNames first, then bodyLocNames
          const fnLoc = (event as { fnLoc?: t.SourceLocation | null }).fnLoc;
          if (fnLoc) {
            const key = locKey(fnLoc);
            fnName = fnLocNames.get(key) ?? bodyLocNames.get(key) ?? null;
          }
        }

        const fnLoc =
          event.kind !== 'Timing'
            ? ((event as { fnLoc?: t.SourceLocation | null }).fnLoc ?? null)
            : null;

        capturedEvents.push({
          kind: event.kind,
          fnLoc,
          fnName,
          raw: event,
        });
      },
    },
  };

  let compiledCode: string | null = null;
  try {
    const result = await transformFromAstAsync(ast, code, {
      filename,
      highlightCode: false,
      plugins: [[BabelPluginReactCompiler, options]],
      sourceType: 'module',
      sourceFileName,
      configFile: false,
      babelrc: false,
    });
    compiledCode = result?.code ?? null;
  } catch {
    // Transformation failed; return whatever events were captured before the error
  }

  return {
    events: capturedEvents,
    compiledCode,
    getComponentEvents(): CapturedEvent[] {
      return capturedEvents.filter(e => {
        if (!e.fnName) return false;
        return isComponentName(e.fnName);
      });
    },
  };
}
