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
