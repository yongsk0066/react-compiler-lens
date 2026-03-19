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

  it('follows re-export chain through barrel files', () => {
    fs.writeFileSync(
      path.join(tmpDir, 'Button.tsx'),
      '"use client";\nexport function Button() { return <button />; }',
    );
    fs.mkdirSync(path.join(tmpDir, 'components'));
    fs.writeFileSync(
      path.join(tmpDir, 'components', 'index.ts'),
      'export { Button } from "../Button";',
    );

    const resolver = new ImportResolver();
    // Without importedName — can't follow re-exports
    expect(resolver.resolveImportDirective(
      path.join(tmpDir, 'Page.tsx'),
      './components',
    )).toBeNull();

    // With importedName — follows re-export to Button.tsx
    expect(resolver.resolveImportDirective(
      path.join(tmpDir, 'Page.tsx'),
      './components',
      'Button',
    )).toBe('use client');
  });

  it('follows star re-exports', () => {
    fs.writeFileSync(
      path.join(tmpDir, 'Dialog.tsx'),
      '"use client";\nexport function Dialog() { return <div />; }',
    );
    fs.mkdirSync(path.join(tmpDir, 'ui'));
    fs.writeFileSync(
      path.join(tmpDir, 'ui', 'index.ts'),
      'export * from "../Dialog";',
    );

    const resolver = new ImportResolver();
    expect(resolver.resolveImportDirective(
      path.join(tmpDir, 'Page.tsx'),
      './ui',
      'Dialog',
    )).toBe('use client');
  });

  it('handles circular re-exports without infinite loop', () => {
    fs.writeFileSync(path.join(tmpDir, 'a.ts'), 'export { Foo } from "./b";');
    fs.writeFileSync(path.join(tmpDir, 'b.ts'), 'export { Foo } from "./a";');

    const resolver = new ImportResolver();
    // Should not hang — returns null due to cycle
    expect(resolver.resolveImportDirective(
      path.join(tmpDir, 'Page.tsx'),
      './a',
      'Foo',
    )).toBeNull();
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
