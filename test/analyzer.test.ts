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
    expect(result.fileKind).toBe('client');
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

  it('reports skip status for "use no memo" component', async () => {
    const filePath = path.join(tmpDir, 'NoMemo.tsx');
    const code = [
      '"use client";',
      'export function NoMemo() {',
      '  "use no memo";',
      '  return <div>skipped</div>;',
      '}',
    ].join('\n');
    fs.writeFileSync(filePath, code);

    const analyzer = new Analyzer({ framework: 'none' });
    const result = await analyzer.analyze(filePath, code);
    const comp = result.declaredComponents.find(c => c.name === 'NoMemo');
    expect(comp).toBeDefined();
    expect(comp!.compileResult.status).toBe('skip');
    if (comp!.compileResult.status === 'skip') {
      expect(comp!.compileResult.reason).not.toContain('[object Object]');
    }
  });

  it('reports skip with clean reason for "use no forget"', async () => {
    const filePath = path.join(tmpDir, 'Legacy.tsx');
    const code = [
      'export function Legacy() {',
      '  "use no forget";',
      '  return <span />;',
      '}',
    ].join('\n');
    fs.writeFileSync(filePath, code);

    const analyzer = new Analyzer({ framework: 'none' });
    const result = await analyzer.analyze(filePath, code);
    const comp = result.declaredComponents.find(c => c.name === 'Legacy');
    expect(comp).toBeDefined();
    expect(comp!.compileResult.status).toBe('skip');
    if (comp!.compileResult.status === 'skip') {
      expect(comp!.compileResult.reason).not.toContain('[object Object]');
    }
  });

  it('handles mixed compiled + skipped components in one file', async () => {
    const filePath = path.join(tmpDir, 'Mixed.tsx');
    const code = [
      'import { useState } from "react";',
      'export function Active() {',
      '  const [x, setX] = useState(0);',
      '  return <div onClick={() => setX(x + 1)}>{x}</div>;',
      '}',
      'export function Skipped() {',
      '  "use no memo";',
      '  return <span />;',
      '}',
    ].join('\n');
    fs.writeFileSync(filePath, code);

    const analyzer = new Analyzer({ framework: 'none' });
    const result = await analyzer.analyze(filePath, code);

    const active = result.declaredComponents.find(c => c.name === 'Active');
    const skipped = result.declaredComponents.find(c => c.name === 'Skipped');
    expect(active?.compileResult.status).toBe('success');
    expect(skipped?.compileResult.status).toBe('skip');
    // File still has compiled output
    expect(result.compiledCode).toBeTruthy();
  });

  it('handles "use server" file directive', async () => {
    const filePath = path.join(tmpDir, 'actions.tsx');
    const code = [
      '"use server";',
      'export async function createUser() {',
      '  return { id: 1 };',
      '}',
    ].join('\n');
    fs.writeFileSync(filePath, code);

    const analyzer = new Analyzer({ framework: 'none' });
    const result = await analyzer.analyze(filePath, code);
    expect(result.directive).toBe('use server');
    expect(result.fileKind).toBe('server-action');
  });

  it('defaults to server component in nextjs when no directive', async () => {
    const filePath = path.join(tmpDir, 'Page.tsx');
    const code = 'export default function Page() { return <div />; }';
    fs.writeFileSync(filePath, code);

    const analyzer = new Analyzer({ framework: 'nextjs' });
    const result = await analyzer.analyze(filePath, code);
    expect(result.framework).toBe('nextjs');
    // No directive — client should interpret as Server Component based on framework
    expect(result.directive).toBeNull();
    expect(result.fileKind).toBe('server-default');
  });

  it('sets fileKind to "client" for use client file', async () => {
    const filePath = path.join(tmpDir, 'Client.tsx');
    const code = '"use client";\nexport function Button() { return <button />; }';
    fs.writeFileSync(filePath, code);
    const analyzer = new Analyzer({ framework: 'none' });
    const result = await analyzer.analyze(filePath, code);
    expect(result.fileKind).toBe('client');
    expect(result.serverActionExports).toEqual([]);
  });

  it('sets fileKind to "server-action" and extracts exports', async () => {
    const filePath = path.join(tmpDir, 'actions.ts');
    const code = '"use server";\nexport async function createUser() { return { id: 1 }; }\nexport async function deleteUser() { return true; }';
    fs.writeFileSync(filePath, code);
    const analyzer = new Analyzer({ framework: 'none' });
    const result = await analyzer.analyze(filePath, code);
    expect(result.fileKind).toBe('server-action');
    expect(result.serverActionExports).toHaveLength(2);
    expect(result.serverActionExports[0].name).toBe('createUser');
    expect(result.serverActionExports[1].name).toBe('deleteUser');
  });

  it('sets fileKind to "server-only" for server-only import', async () => {
    const filePath = path.join(tmpDir, 'util.ts');
    const code = "import 'server-only';\nexport function serverUtil() { return 1; }";
    fs.writeFileSync(filePath, code);
    const analyzer = new Analyzer({ framework: 'nextjs' });
    const result = await analyzer.analyze(filePath, code);
    expect(result.fileKind).toBe('server-only');
    expect(result.serverOnlyImportLine).toBe(1);
  });

  it('sets fileKind to "server-default" for Next.js without directive', async () => {
    const filePath = path.join(tmpDir, 'Page.tsx');
    const code = 'export default function Page() { return <div />; }';
    fs.writeFileSync(filePath, code);
    const analyzer = new Analyzer({ framework: 'nextjs' });
    const result = await analyzer.analyze(filePath, code);
    expect(result.fileKind).toBe('server-default');
  });

  it('sets fileKind to "unknown" for non-Next.js without directive', async () => {
    const filePath = path.join(tmpDir, 'App.tsx');
    const code = 'export default function App() { return <div />; }';
    fs.writeFileSync(filePath, code);
    const analyzer = new Analyzer({ framework: 'none' });
    const result = await analyzer.analyze(filePath, code);
    expect(result.fileKind).toBe('unknown');
  });

  it('sets sourceFileKind on imported components', async () => {
    fs.writeFileSync(path.join(tmpDir, 'Modal.tsx'), '"use client";\nexport function Modal() { return <div />; }');
    const pagePath = path.join(tmpDir, 'Page.tsx');
    const pageCode = 'import { Modal } from "./Modal";\nexport default function Page() { return <Modal />; }';
    fs.writeFileSync(pagePath, pageCode);
    const analyzer = new Analyzer({ framework: 'nextjs' });
    const result = await analyzer.analyze(pagePath, pageCode);
    const modal = result.importedComponents.find(c => c.name === 'Modal');
    expect(modal?.sourceFileKind).toBe('client');
  });

  it('sets sourceFileKind to server-default for directive-less import in Next.js', async () => {
    fs.writeFileSync(path.join(tmpDir, 'Card.tsx'), 'export function Card() { return <div />; }');
    const pagePath = path.join(tmpDir, 'Page.tsx');
    const pageCode = 'import { Card } from "./Card";\nexport default function Page() { return <Card />; }';
    fs.writeFileSync(pagePath, pageCode);
    const analyzer = new Analyzer({ framework: 'nextjs' });
    const result = await analyzer.analyze(pagePath, pageCode);
    const card = result.importedComponents.find(c => c.name === 'Card');
    expect(card?.sourceFileKind).toBe('server-default');
  });
});
