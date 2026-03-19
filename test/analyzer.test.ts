import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { Analyzer } from '../server/src/analyzer';

describe('Analyzer', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'rcl-analyzer-'));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true });
  });

  it('analyzes a client component file', async () => {
    const filePath = path.join(tmpDir, 'Counter.tsx');
    const code = [
      '"use client";',
      'import { useState } from "react";',
      'export default function Counter() {',
      '  const [count, setCount] = useState(0);',
      '  return <button onClick={() => setCount(c => c + 1)}>{count}</button>;',
      '}',
    ].join('\n');
    fs.writeFileSync(filePath, code);

    const analyzer = new Analyzer({ framework: 'none' });
    const result = await analyzer.analyze(filePath, code);

    expect(result.directive).toBe('use client');
    expect(result.declaredComponents.length).toBeGreaterThan(0);
    const counter = result.declaredComponents.find(c => c.name === 'Counter');
    expect(counter).toBeDefined();
    expect(counter!.directive).toBe('use client');
    expect(counter!.compileResult.status).toBe('success');
  });

  it('analyzes imported components for directive', async () => {
    fs.writeFileSync(path.join(tmpDir, 'Button.tsx'), '"use client";\nexport function Button() { return <button />; }');
    const pagePath = path.join(tmpDir, 'Page.tsx');
    const pageCode = [
      'import { Button } from "./Button";',
      'export default function Page() {',
      '  return <Button />;',
      '}',
    ].join('\n');
    fs.writeFileSync(pagePath, pageCode);

    const analyzer = new Analyzer({ framework: 'none' });
    const result = await analyzer.analyze(pagePath, pageCode);

    const buttonImport = result.importedComponents.find(c => c.name === 'Button');
    expect(buttonImport).toBeDefined();
    expect(buttonImport!.directive).toBe('use client');
  });

  it('excludes hooks from declared components', async () => {
    const filePath = path.join(tmpDir, 'hooks.tsx');
    const code = [
      'import { useState } from "react";',
      'export function useCounter() {',
      '  return useState(0);',
      '}',
    ].join('\n');
    fs.writeFileSync(filePath, code);

    const analyzer = new Analyzer({ framework: 'none' });
    const result = await analyzer.analyze(filePath, code);
    expect(result.declaredComponents.find(c => c.name === 'useCounter')).toBeUndefined();
  });

  it('collects JSX tag locations for imported components', async () => {
    fs.writeFileSync(path.join(tmpDir, 'Button.tsx'), '"use client";\nexport function Button() { return <button />; }');
    const pagePath = path.join(tmpDir, 'Page.tsx');
    const pageCode = [
      'import { Button } from "./Button";',
      'export default function Page() {',
      '  return (<><Button /><Button /></>);',
      '}',
    ].join('\n');
    fs.writeFileSync(pagePath, pageCode);

    const analyzer = new Analyzer({ framework: 'none' });
    const result = await analyzer.analyze(pagePath, pageCode);
    const buttonImport = result.importedComponents.find(c => c.name === 'Button');
    expect(buttonImport).toBeDefined();
    expect(buttonImport!.jsxLocations.length).toBe(2);
  });
});
