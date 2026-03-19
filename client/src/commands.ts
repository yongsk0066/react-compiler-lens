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

function compiledUri(fileUri: string): vscode.Uri {
  return vscode.Uri.from({
    scheme: 'react-compiler-lens',
    path: `/${encodeURIComponent(fileUri)}.compiled.tsx`,
  });
}

function cacheKeyFromUri(uri: vscode.Uri): string {
  const match = uri.path.match(/^\/(.+)\.compiled\.tsx$/);
  if (!match) return '';
  return decodeURIComponent(match[1]);
}

export function registerCommands(context: vscode.ExtensionContext, client: LanguageClient): void {
  context.subscriptions.push(
    vscode.workspace.registerTextDocumentContentProvider('react-compiler-lens', {
      onDidChange: compiledCodeChangeEmitter.event,
      provideTextDocumentContent(uri: vscode.Uri): string {
        const fileUri = cacheKeyFromUri(uri);
        return compiledCodeCache.get(fileUri) ?? '// No compiled output available';
      },
    }),
  );

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

  context.subscriptions.push(
    vscode.commands.registerCommand('reactCompilerLens.showProblems', async () => {
      await vscode.commands.executeCommand('workbench.actions.view.problems');
    }),
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('reactCompilerLens.refresh', async () => {
      await client.sendRequest('react-compiler-lens/refresh');
    }),
  );
}

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

async function showSideTab(uri: vscode.Uri): Promise<void> {
  const doc = await vscode.workspace.openTextDocument(uri);
  await vscode.window.showTextDocument(doc, {
    viewColumn: vscode.ViewColumn.Beside,
    preview: true,
    preserveFocus: true,
  });
}

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
