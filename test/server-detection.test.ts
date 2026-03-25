import { describe, expect, it } from 'vitest';
import { detectServerOnlyImportLine, extractServerActionExports } from '../server/src/analyzer';
import { parseCode } from '../server/src/ast';

describe('detectServerOnlyImportLine', () => {
  it('detects import server-only and returns line number', () => {
    const ast = parseCode("import 'server-only';\nexport function foo() {}");
    expect(detectServerOnlyImportLine(ast!)).toBe(1);
  });

  it('returns null when not present', () => {
    const ast = parseCode("export function foo() { return 1; }");
    expect(detectServerOnlyImportLine(ast!)).toBeNull();
  });

  it('ignores server-only in non-import context', () => {
    const ast = parseCode("const x = 'server-only';");
    expect(detectServerOnlyImportLine(ast!)).toBeNull();
  });

  it('detects on correct line when not first line', () => {
    const ast = parseCode("import React from 'react';\nimport 'server-only';");
    expect(detectServerOnlyImportLine(ast!)).toBe(2);
  });
});

describe('extractServerActionExports', () => {
  it('extracts named function export', () => {
    const ast = parseCode("'use server';\nexport async function createUser() {}");
    const actions = extractServerActionExports(ast!);
    expect(actions).toEqual([{ name: 'createUser', line: 2 }]);
  });

  it('extracts arrow function variable export', () => {
    const ast = parseCode("'use server';\nexport const createUser = async () => {};");
    const actions = extractServerActionExports(ast!);
    expect(actions).toHaveLength(1);
    expect(actions[0].name).toBe('createUser');
  });

  it('extracts export specifiers', () => {
    const code = "'use server';\nconst a = 1;\nconst b = 2;\nexport { a, b };";
    const ast = parseCode(code);
    const actions = extractServerActionExports(ast!);
    expect(actions).toHaveLength(2);
    expect(actions.map(a => a.name)).toEqual(['a', 'b']);
  });

  it('extracts named default export', () => {
    const ast = parseCode("'use server';\nexport default async function main() {}");
    const actions = extractServerActionExports(ast!);
    expect(actions).toEqual([{ name: 'main', line: 2 }]);
  });

  it('handles anonymous default export', () => {
    const ast = parseCode("'use server';\nexport default async function() {}");
    const actions = extractServerActionExports(ast!);
    expect(actions[0].name).toBe('default');
  });

  it('extracts multiple mixed exports', () => {
    const code = [
      "'use server';",
      "export async function createUser() {}",
      "export const deleteUser = async () => {};",
    ].join('\n');
    const ast = parseCode(code);
    const actions = extractServerActionExports(ast!);
    expect(actions).toHaveLength(2);
  });

  it('returns empty for file with no exports', () => {
    const ast = parseCode("'use server';\nasync function helper() {}");
    expect(extractServerActionExports(ast!)).toEqual([]);
  });
});
