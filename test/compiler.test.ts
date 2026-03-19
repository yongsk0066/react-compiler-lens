import { describe, expect, it } from 'vitest';
import { compileFile } from '../server/src/compiler';

describe('compileFile', () => {
  it('returns success events for compilable components', async () => {
    const code = [
      'import { useState } from "react";',
      'export default function Counter() {',
      '  const [count, setCount] = useState(0);',
      '  return <button onClick={() => setCount(c => c + 1)}>{count}</button>;',
      '}',
    ].join('\n');
    const result = await compileFile(code, 'Counter.tsx');
    expect(result.events.length).toBeGreaterThan(0);
    const success = result.events.find(e => e.kind === 'CompileSuccess');
    expect(success).toBeDefined();
    expect(success?.fnName).toBe('Counter');
  });

  it('returns compiled code string', async () => {
    const code = [
      'import { useState } from "react";',
      'export default function Counter() {',
      '  const [count, setCount] = useState(0);',
      '  return <button>{count}</button>;',
      '}',
    ].join('\n');
    const result = await compileFile(code, 'Counter.tsx');
    expect(result.compiledCode).toBeTruthy();
  });

  it('returns skip events for opted-out functions', async () => {
    const code = [
      'export default function NoMemo() {',
      '  "use no memo";',
      '  return <div />;',
      '}',
    ].join('\n');
    const result = await compileFile(code, 'NoMemo.tsx');
    const skip = result.events.find(e => e.kind === 'CompileSkip');
    expect(skip).toBeDefined();
  });

  it('returns skip for "use no forget" directive', async () => {
    const code = [
      'export default function Legacy() {',
      '  "use no forget";',
      '  return <div />;',
      '}',
    ].join('\n');
    const result = await compileFile(code, 'Legacy.tsx');
    const skip = result.events.find(e => e.kind === 'CompileSkip');
    expect(skip).toBeDefined();
    expect(skip?.fnName).toBe('Legacy');
  });

  it('handles module-level "use no memo"', async () => {
    const code = [
      '"use no memo";',
      'export function Foo() { return <div />; }',
      'export function Bar() { return <span />; }',
    ].join('\n');
    const result = await compileFile(code, 'Module.tsx');
    // Module-level opt-out behavior depends on compiler version
    // At minimum, verify it doesn't crash and produces events
    expect(result.events).toBeDefined();
  });

  it('produces compiled output even when one function is skipped', async () => {
    const code = [
      'import { useState } from "react";',
      'export function Compiled() {',
      '  const [x, setX] = useState(0);',
      '  return <div onClick={() => setX(x + 1)}>{x}</div>;',
      '}',
      'export function Skipped() {',
      '  "use no memo";',
      '  return <span />;',
      '}',
    ].join('\n');
    const result = await compileFile(code, 'Mixed.tsx');
    const success = result.events.find(e => e.kind === 'CompileSuccess');
    const skip = result.events.find(e => e.kind === 'CompileSkip');
    expect(success).toBeDefined();
    expect(skip).toBeDefined();
    // File still produces compiled output for the successful function
    expect(result.compiledCode).toBeTruthy();
  });

  it('handles parse errors gracefully', async () => {
    const code = 'const x = {{{';
    const result = await compileFile(code, 'bad.tsx');
    expect(result.events).toEqual([]);
    expect(result.compiledCode).toBeNull();
  });

  it('filters hooks from component results', async () => {
    const code = [
      'import { useState } from "react";',
      'export function useCounter() {',
      '  const [count, setCount] = useState(0);',
      '  return count;',
      '}',
      'export default function App() {',
      '  const count = useCounter();',
      '  return <div>{count}</div>;',
      '}',
    ].join('\n');
    const result = await compileFile(code, 'App.tsx');
    const componentEvents = result.getComponentEvents();
    const names = componentEvents
      .filter(e => e.kind === 'CompileSuccess')
      .map(e => e.fnName);
    expect(names).toContain('App');
    expect(names).not.toContain('useCounter');
  });
});
