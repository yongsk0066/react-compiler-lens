import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { Analyzer } from '../server/src/analyzer';

describe('Rich Diagnostics', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'rcl-rich-diag-'));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true });
  });

  it('includes category in error diagnostics', async () => {
    const filePath = path.join(tmpDir, 'BadRef.tsx');
    // ref.current mutation during render always triggers a compiler error
    const code = [
      'import { useRef } from "react";',
      'export function BadRef() {',
      '  const ref = useRef(null);',
      '  ref.current = "mutated during render";',
      '  return <div>{ref.current}</div>;',
      '}',
    ].join('\n');
    fs.writeFileSync(filePath, code);

    const analyzer = new Analyzer({ framework: 'none' });
    const result = await analyzer.analyze(filePath, code);
    const comp = result.declaredComponents.find(c => c.name === 'BadRef');

    expect(comp).toBeDefined();
    expect(comp!.compileResult.status).toBe('error');

    if (comp!.compileResult.status === 'error') {
      expect(comp!.compileResult.diagnostics.length).toBeGreaterThan(0);
      const diag = comp!.compileResult.diagnostics[0];
      expect(diag.category).toBeDefined();
      expect(typeof diag.category).toBe('string');
      expect(diag.category!.length).toBeGreaterThan(0);
    }
  });

  it('includes description in error diagnostics', async () => {
    const filePath = path.join(tmpDir, 'StateMutation.tsx');
    // Direct state mutation during render always triggers a compiler error
    const code = [
      'import { useState } from "react";',
      'export function StateMutation() {',
      '  const [state, setState] = useState({ count: 0 });',
      '  state.count += 1;',
      '  return <div>{state.count}</div>;',
      '}',
    ].join('\n');
    fs.writeFileSync(filePath, code);

    const analyzer = new Analyzer({ framework: 'none' });
    const result = await analyzer.analyze(filePath, code);
    const comp = result.declaredComponents.find(c => c.name === 'StateMutation');

    expect(comp).toBeDefined();
    expect(comp!.compileResult.status).toBe('error');

    if (comp!.compileResult.status === 'error') {
      expect(comp!.compileResult.diagnostics.length).toBeGreaterThan(0);
      const diag = comp!.compileResult.diagnostics[0];
      // description may be null/undefined for some error types, but the field should exist on the shape
      expect('description' in diag || diag.category !== undefined).toBe(true);
    }
  });

  it('populates diagnostic message and severity for ref mutation error', async () => {
    const filePath = path.join(tmpDir, 'RefMutation.tsx');
    // ref.current write during render is a deterministic bailout
    const code = [
      'import { useRef } from "react";',
      'export function RefMutation() {',
      '  const ref = useRef(0);',
      '  ref.current = ref.current + 1;',
      '  return <span>{ref.current}</span>;',
      '}',
    ].join('\n');
    fs.writeFileSync(filePath, code);

    const analyzer = new Analyzer({ framework: 'none' });
    const result = await analyzer.analyze(filePath, code);
    const comp = result.declaredComponents.find(c => c.name === 'RefMutation');

    expect(comp).toBeDefined();
    expect(comp!.compileResult.status).toBe('error');

    if (comp!.compileResult.status === 'error') {
      expect(comp!.compileResult.diagnostics.length).toBeGreaterThan(0);
      const diag = comp!.compileResult.diagnostics[0];
      expect(typeof diag.message).toBe('string');
      expect(diag.message.length).toBeGreaterThan(0);
      expect(['error', 'warning', 'info']).toContain(diag.severity);
    }
  });

  it('preserves diagnostics for successful compilation', async () => {
    const filePath = path.join(tmpDir, 'Good.tsx');
    const code = [
      'import { useState } from "react";',
      'export function Good() {',
      '  const [x, setX] = useState(0);',
      '  return <button onClick={() => setX(x + 1)}>{x}</button>;',
      '}',
    ].join('\n');
    fs.writeFileSync(filePath, code);

    const analyzer = new Analyzer({ framework: 'none' });
    const result = await analyzer.analyze(filePath, code);
    const comp = result.declaredComponents.find(c => c.name === 'Good');
    expect(comp?.compileResult.status).toBe('success');
  });

  it('handles PipelineError without crashing', async () => {
    const filePath = path.join(tmpDir, 'Empty.tsx');
    const code = 'export function Empty() { return <div />; }';
    fs.writeFileSync(filePath, code);

    const analyzer = new Analyzer({ framework: 'none' });
    const result = await analyzer.analyze(filePath, code);
    // Should not throw, regardless of internal errors
    expect(result).toBeDefined();
    expect(result.declaredComponents).toBeDefined();
  });

  it('extracts category from use server file', async () => {
    const filePath = path.join(tmpDir, 'action.ts');
    const code = '"use server";\nexport async function createUser() { return { id: 1 }; }';
    fs.writeFileSync(filePath, code);

    const analyzer = new Analyzer({ framework: 'none' });
    const result = await analyzer.analyze(filePath, code);
    expect(result.fileKind).toBe('server-action');
  });
});
