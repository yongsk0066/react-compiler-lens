import { DiagnosticSeverity } from 'vscode-languageserver/node';
import type { Directive, FileKind } from '@react-compiler-lens/shared';

export interface ComponentVisibilityConfig {
  clientComponent: boolean;
  serverComponent: boolean;
  serverOnly: boolean;
}

export function getKindLabel(directive: Directive): string | null {
  if (directive === 'use client') return 'Client Component';
  if (directive === 'use server') return 'Server Action';
  return null;
}

export function mapSeverity(severityStr: string): DiagnosticSeverity {
  switch (severityStr) {
    case 'error':
      return DiagnosticSeverity.Error;
    case 'info':
      return DiagnosticSeverity.Information;
    case 'warning':
    default:
      return DiagnosticSeverity.Warning;
  }
}

export function shouldShowDeclaredComponent(
  compDirective: Directive,
  fileKind: FileKind,
  cfg: ComponentVisibilityConfig,
): boolean {
  if (compDirective === 'use client' && !cfg.clientComponent) return false;
  if (compDirective === 'use server' && !cfg.serverComponent) return false;
  if (compDirective === null) {
    if (fileKind === 'server-default' && !cfg.serverComponent) return false;
    if (fileKind === 'server-only' && !cfg.serverOnly) return false;
  }
  return true;
}
