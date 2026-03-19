import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { detectFramework } from '../server/src/framework';

describe('detectFramework', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'rcl-fw-'));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true });
  });

  it('detects nextjs when next.config.js exists', () => {
    fs.writeFileSync(path.join(tmpDir, 'next.config.js'), 'module.exports = {}');
    expect(detectFramework(tmpDir)).toBe('nextjs');
  });

  it('detects nextjs when next.config.ts exists', () => {
    fs.writeFileSync(path.join(tmpDir, 'next.config.ts'), 'export default {}');
    expect(detectFramework(tmpDir)).toBe('nextjs');
  });

  it('detects nextjs when next.config.mjs exists', () => {
    fs.writeFileSync(path.join(tmpDir, 'next.config.mjs'), 'export default {}');
    expect(detectFramework(tmpDir)).toBe('nextjs');
  });

  it('returns none when no framework config found', () => {
    expect(detectFramework(tmpDir)).toBe('none');
  });
});
