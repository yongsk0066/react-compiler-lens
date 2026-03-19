import * as vscode from 'vscode';
import type { LanguageClient } from 'vscode-languageclient/node';

export function registerCommands(context: vscode.ExtensionContext, client: LanguageClient): void {
  context.subscriptions.push(
    vscode.commands.registerCommand(
      'reactCompilerLens.peekCompiled',
      async (fileUri: string, _componentName: string) => {
        // Fetch compiled code from LSP server on demand
        const response = await client.sendRequest<{ code: string | null }>(
          'react-compiler-lens/getCompiledCode',
          { uri: fileUri },
        );

        if (!response.code) {
          vscode.window.showInformationMessage('No compiled output available for this file.');
          return;
        }

        // Write compiled code to a virtual document and show in peek
        const compiledUri = vscode.Uri.parse(
          `react-compiler-lens://compiled/${encodeURIComponent(fileUri)}`,
        );

        // Update the virtual document cache
        compiledCodeCache.set(fileUri, response.code);
        compiledCodeChangeEmitter.fire(compiledUri);

        // Get the active editor position for peek anchor
        const editor = vscode.window.activeTextEditor;
        if (!editor) return;

        const position = editor.selection.active;
        const location = new vscode.Location(compiledUri, new vscode.Position(0, 0));

        await vscode.commands.executeCommand(
          'editor.action.peekLocations',
          editor.document.uri,
          position,
          [location],
          'peek',
        );
      },
    ),
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('reactCompilerLens.refresh', () => {
      vscode.commands.executeCommand('workbench.action.reloadWindow');
    }),
  );

  // Register virtual document provider for compiled code
  const provider: vscode.TextDocumentContentProvider = {
    onDidChange: compiledCodeChangeEmitter.event,
    provideTextDocumentContent(uri: vscode.Uri): string {
      const fileUri = decodeURIComponent(uri.path.replace('/compiled/', ''));
      return compiledCodeCache.get(fileUri) ?? '// No compiled output available';
    },
  };

  context.subscriptions.push(
    vscode.workspace.registerTextDocumentContentProvider('react-compiler-lens', provider),
  );
}

// Module-level cache shared between command handler and document provider
const compiledCodeCache = new Map<string, string>();
const compiledCodeChangeEmitter = new vscode.EventEmitter<vscode.Uri>();
