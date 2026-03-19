import * as vscode from 'vscode';
import type { LanguageClient } from 'vscode-languageclient/node';

const compiledCodeCache = new Map<string, string>();
const compiledCodeChangeEmitter = new vscode.EventEmitter<vscode.Uri>();

function compiledUri(fileUri: string): vscode.Uri {
  return vscode.Uri.from({ scheme: 'react-compiler-lens', path: fileUri });
}

export function registerCommands(context: vscode.ExtensionContext, client: LanguageClient): void {
  // Virtual document provider for compiled code peek
  context.subscriptions.push(
    vscode.workspace.registerTextDocumentContentProvider('react-compiler-lens', {
      onDidChange: compiledCodeChangeEmitter.event,
      provideTextDocumentContent(uri: vscode.Uri): string {
        return compiledCodeCache.get(uri.path) ?? '// No compiled output available';
      },
    }),
  );

  // Peek compiled output — anchored at the component declaration line
  context.subscriptions.push(
    vscode.commands.registerCommand(
      'reactCompilerLens.peekCompiled',
      async (fileUri: string, _componentName: string, line?: number) => {
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
          vscode.window.showInformationMessage('No compiled output available.');
          return;
        }

        compiledCodeCache.set(fileUri, code);
        compiledCodeChangeEmitter.fire(compiledUri(fileUri));

        const editor = vscode.window.activeTextEditor;
        if (!editor) return;

        // Anchor peek at the component declaration line, not cursor
        const anchorLine = line ?? editor.selection.active.line;
        const anchorPosition = new vscode.Position(anchorLine, 0);
        const targetLocation = new vscode.Location(compiledUri(fileUri), new vscode.Position(0, 0));

        await vscode.commands.executeCommand(
          'editor.action.peekLocations',
          editor.document.uri,
          anchorPosition,
          [targetLocation],
          'peek',
        );
      },
    ),
  );

  // Show Problems panel — for Not Optimized components
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
