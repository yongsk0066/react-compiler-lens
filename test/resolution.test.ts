import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { ImportResolver } from '../server/src/resolution';

describe('ImportResolver', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'rcl-res-'));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true });
  });

  it('resolves relative import and returns directive', () => {
    fs.writeFileSync(path.join(tmpDir, 'Button.tsx'), '"use client";\nexport function Button() { return <button />; }');
    fs.writeFileSync(path.join(tmpDir, 'Page.tsx'), 'import { Button } from "./Button";\nexport default function Page() { return <Button />; }');
    const resolver = new ImportResolver();
    const directive = resolver.resolveImportDirective(path.join(tmpDir, 'Page.tsx'), './Button');
    expect(directive).toBe('use client');
  });

  it('returns null for files without directive', () => {
    fs.writeFileSync(path.join(tmpDir, 'Layout.tsx'), 'export function Layout() { return <div />; }');
    const resolver = new ImportResolver();
    const directive = resolver.resolveImportDirective(path.join(tmpDir, 'Page.tsx'), './Layout');
    expect(directive).toBeNull();
  });

  it('caches directive results', () => {
    fs.writeFileSync(path.join(tmpDir, 'Button.tsx'), '"use client";\nexport function Button() { return <button />; }');
    const resolver = new ImportResolver();
    const d1 = resolver.resolveImportDirective(path.join(tmpDir, 'Page.tsx'), './Button');
    const d2 = resolver.resolveImportDirective(path.join(tmpDir, 'Page.tsx'), './Button');
    expect(d1).toBe(d2);
    expect(d1).toBe('use client');
  });

  it('invalidates cache for a file', () => {
    fs.writeFileSync(path.join(tmpDir, 'Button.tsx'), 'export function Button() { return <button />; }');
    const resolver = new ImportResolver();
    expect(resolver.resolveImportDirective(path.join(tmpDir, 'Page.tsx'), './Button')).toBeNull();
    fs.writeFileSync(path.join(tmpDir, 'Button.tsx'), '"use client";\nexport function Button() { return <button />; }');
    resolver.invalidate(path.join(tmpDir, 'Button.tsx'));
    expect(resolver.resolveImportDirective(path.join(tmpDir, 'Page.tsx'), './Button')).toBe('use client');
  });
});
