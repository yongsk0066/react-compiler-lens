import * as vscode from 'vscode';
import type { LanguageClient } from 'vscode-languageclient/node';

/** Cache of compiled code keyed by original file URI */
const compiledCodeCache = new Map<string, string>();
const compiledCodeChangeEmitter = new vscode.EventEmitter<vscode.Uri>();

/**
 * Build a virtual document URI for a given file URI.
 * Format: react-compiler-lens:{fileUri}
 * Simple scheme — the fileUri IS the path, no encoding gymnastics.
 */
function compiledUri(fileUri: string): vscode.Uri {
  return vscode.Uri.from({ scheme: 'react-compiler-lens', path: fileUri });
}

export function registerCommands(context: vscode.ExtensionContext, client: LanguageClient): void {
  // Virtual document provider — serves compiled code for peek preview
  context.subscriptions.push(
    vscode.workspace.registerTextDocumentContentProvider('react-compiler-lens', {
      onDidChange: compiledCodeChangeEmitter.event,
      provideTextDocumentContent(uri: vscode.Uri): string {
        return compiledCodeCache.get(uri.path) ?? '// No compiled output available';
      },
    }),
  );

  // Peek compiled output command
  context.subscriptions.push(
    vscode.commands.registerCommand(
      'reactCompilerLens.peekCompiled',
      async (fileUri: string, _componentName: string) => {
        // Fetch compiled code from LSP server on demand
        let code: string | null = null;
        try {
          const response = await client.sendRequest<{ code: string | null }>(
            'react-compiler-lens/getCompiledCode',
            { uri: fileUri },
          );
          code = response.code;
        } catch {
          // Request failed
        }

        if (!code) {
          vscode.window.showInformationMessage('No compiled output available for this file.');
          return;
        }

        // Update virtual document cache
        compiledCodeCache.set(fileUri, code);
        compiledCodeChangeEmitter.fire(compiledUri(fileUri));

        // Show in peek view anchored at current cursor
        const editor = vscode.window.activeTextEditor;
        if (!editor) return;

        await vscode.commands.executeCommand(
          'editor.action.peekLocations',
          editor.document.uri,
          editor.selection.active,
          [new vscode.Location(compiledUri(fileUri), new vscode.Position(0, 0))],
          'peek',
        );
      },
    ),
  );

  // Manual refresh command
  context.subscriptions.push(
    vscode.commands.registerCommand('reactCompilerLens.refresh', () => {
      vscode.commands.executeCommand('workbench.action.reloadWindow');
    }),
  );
}
