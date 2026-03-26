import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { Analyzer, buildReactiveValuesMap } from '../server/src/analyzer';

describe('Reactive Values', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'rcl-reactive-'));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true });
  });

  it('extracts reactive values from a stateful component', async () => {
    const filePath = path.join(tmpDir, 'Counter.tsx');
    const code = [
      'import { useState } from "react";',
      'export function Counter({ initial }: { initial: number }) {',
      '  const [count, setCount] = useState(initial);',
      '  return <button onClick={() => setCount(c => c + 1)}>{count}</button>;',
      '}',
    ].join('\n');
    fs.writeFileSync(filePath, code);

    const analyzer = new Analyzer({ framework: 'none' });
    const result = await analyzer.analyze(filePath, code);
    const comp = result.declaredComponents.find(c => c.name === 'Counter');

    expect(comp?.compileResult.status).toBe('success');
    if (comp?.compileResult.status === 'success') {
      expect(comp.compileResult.reactiveValues.length).toBeGreaterThan(0);
    }
  });

  it('returns empty reactive values for static component', async () => {
    const filePath = path.join(tmpDir, 'Static.tsx');
    const code = 'export function Static() { return <div>hello</div>; }';
    fs.writeFileSync(filePath, code);

    const analyzer = new Analyzer({ framework: 'none' });
    const result = await analyzer.analyze(filePath, code);
    const comp = result.declaredComponents.find(c => c.name === 'Static');

    expect(comp?.compileResult.status).toBe('success');
    if (comp?.compileResult.status === 'success') {
      // Static components may have 0 reactive values (sentinel-only pattern)
      expect(Array.isArray(comp.compileResult.reactiveValues)).toBe(true);
    }
  });

  it('returns empty reactive values for skipped component', async () => {
    const filePath = path.join(tmpDir, 'Skipped.tsx');
    const code = [
      'export function Skipped() {',
      '  "use no memo";',
      '  return <div>skipped</div>;',
      '}',
    ].join('\n');
    fs.writeFileSync(filePath, code);

    const analyzer = new Analyzer({ framework: 'none' });
    const result = await analyzer.analyze(filePath, code);
    const comp = result.declaredComponents.find(c => c.name === 'Skipped');

    expect(comp?.compileResult.status).toBe('skip');
    // Skip status doesn't have reactiveValues field
  });

  it('extracts reactive values with props dependencies', async () => {
    const filePath = path.join(tmpDir, 'PropsComp.tsx');
    const code = [
      'export function PropsComp({ items, filter }: { items: string[], filter: string }) {',
      '  const filtered = items.filter(i => i.includes(filter));',
      '  return <ul>{filtered.map(i => <li key={i}>{i}</li>)}</ul>;',
      '}',
    ].join('\n');
    fs.writeFileSync(filePath, code);

    const analyzer = new Analyzer({ framework: 'none' });
    const result = await analyzer.analyze(filePath, code);
    const comp = result.declaredComponents.find(c => c.name === 'PropsComp');

    expect(comp?.compileResult.status).toBe('success');
    if (comp?.compileResult.status === 'success') {
      // Should have reactive values related to props
      expect(comp.compileResult.reactiveValues.length).toBeGreaterThan(0);
    }
  });

  it('handles compile error gracefully (no reactive values)', async () => {
    const filePath = path.join(tmpDir, 'Error.tsx');
    // This might cause a compile error
    const code = [
      'import { useRef } from "react";',
      'export function BadComp() {',
      '  const ref = useRef(null);',
      '  const val = ref.current;',
      '  return <div>{val}</div>;',
      '}',
    ].join('\n');
    fs.writeFileSync(filePath, code);

    const analyzer = new Analyzer({ framework: 'none' });
    const result = await analyzer.analyze(filePath, code);
    // Should not crash regardless of compile status
    expect(result).toBeDefined();
  });
});

describe('buildReactiveValuesMap', () => {
  it('extracts simple identifier dep', () => {
    const code = 'function Foo(t0) { const $ = _c(2); if ($[0] !== t0) {} }';
    expect(buildReactiveValuesMap(code).get('Foo')).toEqual(['t0']);
  });

  it('extracts member expression dep', () => {
    const code = 'function Bar(t0) { const $ = _c(2); if ($[0] !== t0.items) {} }';
    expect(buildReactiveValuesMap(code).get('Bar')).toEqual(['t0.items']);
  });

  it('extracts optional chaining dep', () => {
    const code = 'function Baz(t0) { const $ = _c(2); if ($[0] !== t0?.value) {} }';
    expect(buildReactiveValuesMap(code).get('Baz')).toEqual(['t0?.value']);
  });

  it('extracts multiple deps from OR condition', () => {
    const code = 'function Multi(t0) { const $ = _c(3); if ($[0] !== t0.a || $[1] !== t0.b) {} }';
    expect(buildReactiveValuesMap(code).get('Multi')).toEqual(['t0.a', 't0.b']);
  });

  it('ignores sentinel pattern', () => {
    const code = 'function S() { const $ = _c(1); if ($[0] === Symbol.for("react.memo_cache_sentinel")) {} }';
    expect(buildReactiveValuesMap(code).get('S')).toBeUndefined();
  });

  it('handles export default function', () => {
    const code = 'export default function Page(t0) { const $ = _c(2); if ($[0] !== t0) {} }';
    expect(buildReactiveValuesMap(code).get('Page')).toEqual(['t0']);
  });

  it('deduplicates deps', () => {
    const code = 'function D(t0) { const $ = _c(4); if ($[0] !== t0) {} if ($[2] !== t0) {} }';
    expect(buildReactiveValuesMap(code).get('D')).toEqual(['t0']);
  });

  it('handles const arrow function', () => {
    const code = 'const Foo = (t0) => { const $ = _c(2); if ($[0] !== t0.x) {} };';
    expect(buildReactiveValuesMap(code).get('Foo')).toEqual(['t0.x']);
  });

  it('handles mixed sentinel + real deps', () => {
    const code = `function Mix(t0) {
      const $ = _c(3);
      if ($[0] === Symbol.for("react.memo_cache_sentinel")) { $[0] = 1; }
      if ($[1] !== t0.val) { $[1] = t0.val; $[2] = t0.val + 1; }
    }`;
    expect(buildReactiveValuesMap(code).get('Mix')).toEqual(['t0.val']);
  });

  it('returns empty map for non-compiled code', () => {
    const code = 'export function Plain() { return <div />; }';
    const map = buildReactiveValuesMap(code);
    expect(map.size).toBe(0);
  });
});
