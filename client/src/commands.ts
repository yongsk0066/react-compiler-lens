import * as vscode from 'vscode';
import type { CompiledDocumentProvider } from './virtualDocument';

export function registerCommands(context: vscode.ExtensionContext, compiledProvider: CompiledDocumentProvider): void {
  context.subscriptions.push(
    vscode.commands.registerCommand('reactCompilerLens.peekCompiled', async (fileUri: string, componentName: string) => {
      const uri = vscode.Uri.parse(`react-compiler-lens://compiled/${encodeURIComponent(fileUri)}`);
      const doc = await vscode.workspace.openTextDocument(uri);
      await vscode.window.showTextDocument(doc, { viewColumn: vscode.ViewColumn.Beside, preview: true, preserveFocus: true });
    }),
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('reactCompilerLens.refresh', () => {
      vscode.commands.executeCommand('workbench.action.reloadWindow');
    }),
  );
}
