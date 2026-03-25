import { describe, expect, it } from 'vitest';
import { getKindLabel, mapSeverity, shouldShowDeclaredComponent } from '../server/src/labels';

// DiagnosticSeverity numeric values from vscode-languageserver-types
const Severity = { Error: 1, Warning: 2, Information: 3 } as const;

// Minimal config that satisfies ComponentVisibilityConfig
const allOn = { clientComponent: true, serverComponent: true, serverOnly: true };
const allOff = { clientComponent: false, serverComponent: false, serverOnly: false };

describe('getKindLabel', () => {
  it('returns "Client Component" for use client', () => {
    expect(getKindLabel('use client')).toBe('Client Component');
  });

  it('returns "Server Action" for use server', () => {
    expect(getKindLabel('use server')).toBe('Server Action');
  });

  it('returns null for null directive', () => {
    expect(getKindLabel(null)).toBeNull();
  });
});

describe('mapSeverity', () => {
  it('maps "error" to Severity.Error', () => {
    expect(mapSeverity('error')).toBe(Severity.Error);
  });

  it('maps "warning" to Severity.Warning', () => {
    expect(mapSeverity('warning')).toBe(Severity.Warning);
  });

  it('maps "info" to Severity.Information', () => {
    expect(mapSeverity('info')).toBe(Severity.Information);
  });

  it('defaults to Severity.Warning for unknown string', () => {
    expect(mapSeverity('unknown')).toBe(Severity.Warning);
  });

  it('defaults to Severity.Warning for empty string', () => {
    expect(mapSeverity('')).toBe(Severity.Warning);
  });
});

describe('shouldShowDeclaredComponent', () => {
  // --- use client directive ---
  it('shows client component when clientComponent is true', () => {
    expect(shouldShowDeclaredComponent('use client', 'client', allOn)).toBe(true);
  });

  it('hides client component when clientComponent is false', () => {
    expect(shouldShowDeclaredComponent('use client', 'client', allOff)).toBe(false);
  });

  it('shows client component regardless of serverComponent flag', () => {
    expect(shouldShowDeclaredComponent('use client', 'client', { ...allOn, serverComponent: false })).toBe(true);
  });

  // --- use server directive ---
  it('shows server action when serverComponent is true', () => {
    expect(shouldShowDeclaredComponent('use server', 'server-action', allOn)).toBe(true);
  });

  it('hides server action when serverComponent is false', () => {
    expect(shouldShowDeclaredComponent('use server', 'server-action', allOff)).toBe(false);
  });

  it('shows server action regardless of clientComponent flag', () => {
    expect(shouldShowDeclaredComponent('use server', 'server-action', { ...allOn, clientComponent: false })).toBe(true);
  });

  // --- null directive + server-default file kind ---
  it('shows server-default component when serverComponent is true', () => {
    expect(shouldShowDeclaredComponent(null, 'server-default', allOn)).toBe(true);
  });

  it('hides server-default component when serverComponent is false', () => {
    expect(shouldShowDeclaredComponent(null, 'server-default', { ...allOn, serverComponent: false })).toBe(false);
  });

  // --- null directive + server-only file kind ---
  it('shows server-only component when serverOnly is true', () => {
    expect(shouldShowDeclaredComponent(null, 'server-only', allOn)).toBe(true);
  });

  it('hides server-only component when serverOnly is false', () => {
    expect(shouldShowDeclaredComponent(null, 'server-only', { ...allOn, serverOnly: false })).toBe(false);
  });

  // --- null directive + other file kinds ---
  it('shows component with null directive and client file kind regardless of flags', () => {
    expect(shouldShowDeclaredComponent(null, 'client', allOff)).toBe(true);
  });

  it('shows component with null directive and unknown file kind regardless of flags', () => {
    expect(shouldShowDeclaredComponent(null, 'unknown', allOff)).toBe(true);
  });

  it('shows component with null directive and server-action file kind regardless of flags', () => {
    expect(shouldShowDeclaredComponent(null, 'server-action', allOff)).toBe(true);
  });
});
