import * as vscode from 'vscode';
import type { LanguageClient } from 'vscode-languageclient/node';

const MAX_CACHE_SIZE = 10;
const compiledCodeCache = new Map<string, string>();
const compiledCodeChangeEmitter = new vscode.EventEmitter<vscode.Uri>();

function cacheSet(key: string, value: string): void {
  if (compiledCodeCache.size >= MAX_CACHE_SIZE && !compiledCodeCache.has(key)) {
    const oldest = compiledCodeCache.keys().next().value!;
    compiledCodeCache.delete(oldest);
  }
  compiledCodeCache.set(key, value);
}

/**
 * Build a virtual document URI that VS Code recognizes as TypeScript React.
 * The .tsx extension triggers automatic syntax highlighting.
 */
function compiledUri(fileUri: string): vscode.Uri {
  return vscode.Uri.from({
    scheme: 'react-compiler-lens',
    path: `/${encodeURIComponent(fileUri)}.compiled.tsx`,
  });
}

function cacheKeyFromUri(uri: vscode.Uri): string {
  // Extract original fileUri from /encoded.compiled.tsx
  const match = uri.path.match(/^\/(.+)\.compiled\.tsx$/);
  if (!match) return '';
  return decodeURIComponent(match[1]);
}

export function registerCommands(context: vscode.ExtensionContext, client: LanguageClient): void {
  // Virtual document provider — serves compiled code with tsx syntax highlighting
  context.subscriptions.push(
    vscode.workspace.registerTextDocumentContentProvider('react-compiler-lens', {
      onDidChange: compiledCodeChangeEmitter.event,
      provideTextDocumentContent(uri: vscode.Uri): string {
        const fileUri = cacheKeyFromUri(uri);
        return compiledCodeCache.get(fileUri) ?? '// No compiled output available';
      },
    }),
  );

  // Peek / Side tab compiled output
  context.subscriptions.push(
    vscode.commands.registerCommand(
      'reactCompilerLens.peekCompiled',
      async (fileUri: string, _componentName: string, line?: number) => {
        const code = await fetchCompiledCode(client, fileUri);
        if (!code) {
          vscode.window.showInformationMessage('No compiled output available.');
          return;
        }

        cacheSet(fileUri, code);
        const uri = compiledUri(fileUri);
        compiledCodeChangeEmitter.fire(uri);

        const viewMode = vscode.workspace
          .getConfiguration('reactCompilerLens')
          .get<string>('compiledOutput.viewMode', 'side');

        if (viewMode === 'peek') {
          await showPeek(uri, line);
        } else {
          await showSideTab(uri);
        }
      },
    ),
  );

  // Show Problems panel
  context.subscriptions.push(
    vscode.commands.registerCommand('reactCompilerLens.showProblems', async () => {
      await vscode.commands.executeCommand('workbench.actions.view.problems');
    }),
  );

  // Manual refresh
  context.subscriptions.push(
    vscode.commands.registerCommand('reactCompilerLens.refresh', () => {
      vscode.commands.executeCommand('workbench.action.reloadWindow');
    }),
  );
}

/** Fetch compiled code from LSP server on demand. */
async function fetchCompiledCode(client: LanguageClient, fileUri: string): Promise<string | null> {
  try {
    const response = await client.sendRequest<{ code: string | null }>(
      'react-compiler-lens/getCompiledCode',
      { uri: fileUri },
    );
    return response.code;
  } catch {
    return null;
  }
}

/** Open compiled output in a side editor tab (Svelte-style). */
async function showSideTab(uri: vscode.Uri): Promise<void> {
  const doc = await vscode.workspace.openTextDocument(uri);
  await vscode.window.showTextDocument(doc, {
    viewColumn: vscode.ViewColumn.Beside,
    preview: true,
    preserveFocus: true,
  });
}

/** Open compiled output in an inline peek view. */
async function showPeek(uri: vscode.Uri, line?: number): Promise<void> {
  const editor = vscode.window.activeTextEditor;
  if (!editor) return;

  const anchorLine = line ?? editor.selection.active.line;
  const anchorPosition = new vscode.Position(anchorLine, 0);
  const targetLocation = new vscode.Location(uri, new vscode.Position(0, 0));

  await vscode.commands.executeCommand(
    'editor.action.peekLocations',
    editor.document.uri,
    anchorPosition,
    [targetLocation],
    'peek',
  );
}
