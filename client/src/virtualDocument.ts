import * as vscode from 'vscode';

export class CompiledDocumentProvider implements vscode.TextDocumentContentProvider {
  private _onDidChange = new vscode.EventEmitter<vscode.Uri>();
  readonly onDidChange = this._onDidChange.event;
  private compiledCodeCache = new Map<string, string>();

  provideTextDocumentContent(uri: vscode.Uri): string {
    const fileUri = decodeURIComponent(uri.path.replace('/compiled/', ''));
    return this.compiledCodeCache.get(fileUri) ?? '// No compiled output available';
  }

  updateCompiledCode(fileUri: string, code: string): void {
    this.compiledCodeCache.set(fileUri, code);
    const uri = vscode.Uri.parse(`react-compiler-lens://compiled/${encodeURIComponent(fileUri)}`);
    this._onDidChange.fire(uri);
  }

  dispose(): void {
    this._onDidChange.dispose();
  }
}
