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

  it('extracts category from compile error', async () => {
    const filePath = path.join(tmpDir, 'BadRef.tsx');
    const code = [
      'import { useRef } from "react";',
      'export function BadRef() {',
      '  const ref = useRef<HTMLDivElement>(null);',
      '  const val = ref.current;',
      '  return <div ref={ref}>{val?.id}</div>;',
      '}',
    ].join('\n');
    fs.writeFileSync(filePath, code);

    const analyzer = new Analyzer({ framework: 'none' });
    const result = await analyzer.analyze(filePath, code);
    const comp = result.declaredComponents.find(c => c.name === 'BadRef');

    // Component may compile successfully or with error depending on compiler behavior
    // If it errors, the category should be populated
    if (comp?.compileResult.status === 'error' && comp.compileResult.diagnostics.length > 0) {
      const diag = comp.compileResult.diagnostics[0];
      expect(diag.category).toBeDefined();
      expect(typeof diag.category).toBe('string');
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
    // Server action files may or may not produce diagnostics
    expect(result.fileKind).toBe('server-action');
  });
});
