import { describe, expect, it } from 'vitest';
import { extractFileDirective, extractFunctionDirectives } from '../server/src/directives';

describe('extractFileDirective', () => {
  it('returns "use client" for file with use client directive', () => {
    const code = `"use client";\nexport function Counter() { return <div />; }`;
    expect(extractFileDirective(code)).toBe('use client');
  });

  it('returns "use server" for file with use server directive', () => {
    const code = `"use server";\nexport async function createUser() {}`;
    expect(extractFileDirective(code)).toBe('use server');
  });

  it('returns null for file without directive', () => {
    const code = `export function Page() { return <div />; }`;
    expect(extractFileDirective(code)).toBeNull();
  });

  it('handles single quotes', () => {
    const code = `'use client';\nexport function Counter() { return <div />; }`;
    expect(extractFileDirective(code)).toBe('use client');
  });

  it('ignores directive in comments', () => {
    const code = `// "use client"\nexport function Page() { return <div />; }`;
    expect(extractFileDirective(code)).toBeNull();
  });
});

describe('extractFunctionDirectives', () => {
  it('detects function-level use server directive', () => {
    const code = [
      'export default function Page() {',
      '  async function createUser() {',
      '    "use server";',
      '  }',
      '  return <div />;',
      '}',
    ].join('\n');
    const result = extractFunctionDirectives(code);
    expect(result.get('createUser')).toBe('use server');
  });

  it('returns empty map when no function-level directives', () => {
    const code = `export function Page() { return <div />; }`;
    const result = extractFunctionDirectives(code);
    expect(result.size).toBe(0);
  });
});
