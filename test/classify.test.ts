import { describe, expect, it } from 'vitest';
import { classifyFunctions } from '../server/src/classify';
import { parseCode } from '../server/src/ast';

function classify(code: string) {
  const ast = parseCode(code);
  if (!ast) return new Map();
  return classifyFunctions(ast);
}

describe('classifyFunctions', () => {
  it('classifies component with hooks as Component', () => {
    const result = classify(`
      import { useState } from 'react';
      export function Counter() {
        const [count, setCount] = useState(0);
        return <button>{count}</button>;
      }
    `);
    expect(result.get('Counter')).toBe('Component');
  });

  it('classifies hook as Hook', () => {
    const result = classify(`
      import { useState } from 'react';
      export function useCounter() {
        return useState(0);
      }
    `);
    expect(result.get('useCounter')).toBe('Hook');
  });

  it('ignores constants', () => {
    const result = classify(`export const SOME_CONST = 'hello';`);
    expect(result.size).toBe(0);
  });

  it('ignores regular functions', () => {
    const result = classify(`export function formatDate(d) { return d.toString(); }`);
    expect(result.size).toBe(0);
  });

  it('ignores PascalCase function without JSX/hooks', () => {
    const result = classify(`export function MyHelper(x) { return x * 2; }`);
    expect(result.size).toBe(0);
  });

  it.todo('classifies forwardRef as Component — getFunctionName needs CallExpression parent traversal', () => {
    const result = classify(`
      import React from 'react';
      export const MyInput = React.forwardRef((props, ref) => {
        return <input ref={ref} {...props} />;
      });
    `);
    expect(result.get('MyInput')).toBe('Component');
  });

  it.todo('classifies memo as Component — same issue as forwardRef', () => {
    const result = classify(`
      import React from 'react';
      export const MemoComp = React.memo(function Inner() {
        return <div>hello</div>;
      });
    `);
    // memo wraps Inner, so Inner is classified
    const values = [...result.values()];
    expect(values).toContain('Component');
  });

  it('classifies arrow component with hooks', () => {
    const result = classify(`
      import { useState } from 'react';
      export const ArrowComp = () => {
        const [x, setX] = useState(0);
        return <div>{x}</div>;
      };
    `);
    expect(result.get('ArrowComp')).toBe('Component');
  });

  it('classifies component with JSX only (no hooks)', () => {
    const result = classify(`
      export default function Page() {
        return <div>Hello</div>;
      }
    `);
    expect(result.get('Page')).toBe('Component');
  });

  it('classifies async component with JSX', () => {
    const result = classify(`
      export default async function Page() {
        return <div>Hello</div>;
      }
    `);
    expect(result.get('Page')).toBe('Component');
  });

  it('returns empty map for types-only file', () => {
    const result = classify(`
      export interface User { id: number; name: string; }
      export type Status = 'active' | 'inactive';
    `);
    expect(result.size).toBe(0);
  });
});
