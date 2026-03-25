import { describe, expect, it } from 'vitest';
import { determineFileKind, getDeclaredComponentLabel, deriveSourceFileKind } from '../server/src/analyzer';

describe('determineFileKind', () => {
  it('returns "client" for use client directive', () => {
    expect(determineFileKind('use client', false, 'nextjs')).toBe('client');
  });

  it('returns "server-action" for use server directive', () => {
    expect(determineFileKind('use server', false, 'none')).toBe('server-action');
  });

  it('returns "server-only" when server-only import detected', () => {
    expect(determineFileKind(null, true, 'nextjs')).toBe('server-only');
  });

  it('returns "server-default" for Next.js without directive', () => {
    expect(determineFileKind(null, false, 'nextjs')).toBe('server-default');
  });

  it('returns "unknown" for non-Next.js without directive', () => {
    expect(determineFileKind(null, false, 'none')).toBe('unknown');
  });

  it('directive takes precedence over server-only', () => {
    expect(determineFileKind('use client', true, 'nextjs')).toBe('client');
    expect(determineFileKind('use server', true, 'nextjs')).toBe('server-action');
  });

  it('server-only takes precedence over framework default', () => {
    expect(determineFileKind(null, true, 'nextjs')).toBe('server-only');
  });
});

describe('getDeclaredComponentLabel', () => {
  it('returns "Client Component" for use client', () => {
    expect(getDeclaredComponentLabel('use client', 'client', true)).toBe('Client Component');
  });

  it('returns "Server Component (default)" with suffix on', () => {
    expect(getDeclaredComponentLabel(null, 'server-default', true)).toBe('Server Component (default)');
  });

  it('returns "Server Component" with suffix off', () => {
    expect(getDeclaredComponentLabel(null, 'server-default', false)).toBe('Server Component');
  });

  it('returns "server-only" for server-only file', () => {
    expect(getDeclaredComponentLabel(null, 'server-only', true)).toBe('server-only');
  });

  it('returns null for unknown file kind', () => {
    expect(getDeclaredComponentLabel(null, 'unknown', true)).toBeNull();
  });

  it('component directive overrides file kind', () => {
    expect(getDeclaredComponentLabel('use client', 'server-default', true)).toBe('Client Component');
  });
});

describe('deriveSourceFileKind', () => {
  it('maps use client to client', () => {
    expect(deriveSourceFileKind('use client', 'nextjs')).toBe('client');
  });

  it('maps use server to server-action', () => {
    expect(deriveSourceFileKind('use server', 'none')).toBe('server-action');
  });

  it('maps null + nextjs to server-default', () => {
    expect(deriveSourceFileKind(null, 'nextjs')).toBe('server-default');
  });

  it('maps null + none to unknown', () => {
    expect(deriveSourceFileKind(null, 'none')).toBe('unknown');
  });
});
