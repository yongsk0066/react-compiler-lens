import { parseAsync, transformFromAstAsync } from '@babel/core';
import type * as t from '@babel/types';
import type { LoggerEvent, PluginOptions } from 'babel-plugin-react-compiler';
import { walkAst, isFunctionNode, isComponentName } from './ast';

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

let cachedPlugin: unknown = null;

async function getReactCompilerPlugin(): Promise<unknown> {
  if (cachedPlugin) return cachedPlugin;
  const mod = await import('babel-plugin-react-compiler');
  cachedPlugin = (mod as any).default ?? mod;
  return cachedPlugin;
}

function locKey(loc: t.SourceLocation): string {
  return `${loc.start.line}:${loc.start.column}-${loc.end.line}:${loc.end.column}`;
}

export async function compileFile(
  code: string,
  filename: string,
): Promise<CompileFileResult> {
  const empty: CompileFileResult = { events: [], compiledCode: null, getComponentEvents: () => [] };

  let ast: Awaited<ReturnType<typeof parseAsync>>;
  try {
    ast = await parseAsync(code, {
      sourceFileName: filename,
      parserOpts: { plugins: ['typescript', 'jsx'] },
      sourceType: 'module',
      configFile: false,
      babelrc: false,
    });
  } catch {
    return empty;
  }
  if (!ast) return empty;

  const fnLocNames = new Map<string, string>();
  const bodyLocNames = new Map<string, string>();

  walkAst(ast as unknown as t.Node, (node) => {
    if (isFunctionNode(node) && node.loc) {
      const name = resolveFnName(node);
      if (name) {
        fnLocNames.set(locKey(node.loc!), name);
        if (node.body.type === 'BlockStatement' && node.body.loc) {
          bodyLocNames.set(locKey(node.body.loc), name);
        }
      }
    }

    if (node.type === 'VariableDeclarator') {
      const decl = node as t.VariableDeclarator;
      if (decl.id.type === 'Identifier' && decl.init && isFunctionNode(decl.init)) {
        const name = decl.id.name;
        const fn = decl.init as t.FunctionExpression | t.ArrowFunctionExpression;
        if (fn.loc) fnLocNames.set(locKey(fn.loc), name);
        if (fn.body.type === 'BlockStatement' && fn.body.loc) {
          bodyLocNames.set(locKey(fn.body.loc), name);
        }
      }
    }
  });

  const capturedEvents: CapturedEvent[] = [];
  const BabelPluginReactCompiler = await getReactCompilerPlugin();

  const options: Partial<PluginOptions> = {
    panicThreshold: 'none',
    logger: {
      logEvent(_filename: string | null, event: LoggerEvent) {
        if (event.kind === 'Timing') return;

        let fnName: string | null = null;
        if (event.kind === 'CompileSuccess' && event.fnName) {
          fnName = event.fnName;
        } else {
          const fnLoc = (event as { fnLoc?: t.SourceLocation | null }).fnLoc;
          if (fnLoc) {
            const key = locKey(fnLoc);
            fnName = fnLocNames.get(key) ?? bodyLocNames.get(key) ?? null;
          }
        }

        const fnLoc = (event as { fnLoc?: t.SourceLocation | null }).fnLoc ?? null;
        capturedEvents.push({ kind: event.kind, fnLoc, fnName, raw: event });
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
      sourceFileName: filename,
      configFile: false,
      babelrc: false,
    });
    compiledCode = result?.code ?? null;
  } catch {
    // Transformation failed — events already captured via logger
  }

  return {
    events: capturedEvents,
    compiledCode,
    getComponentEvents() {
      return capturedEvents.filter(e => e.fnName && isComponentName(e.fnName));
    },
  };
}

function resolveFnName(
  fn: t.FunctionDeclaration | t.FunctionExpression | t.ArrowFunctionExpression,
): string | null {
  if ((fn.type === 'FunctionDeclaration' || fn.type === 'FunctionExpression') && fn.id) {
    return fn.id.name;
  }
  return null;
}
