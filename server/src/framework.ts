import * as fs from 'node:fs';
import * as path from 'node:path';
import type { Framework } from '@react-compiler-lens/shared';

const NEXT_CONFIG_FILES = ['next.config.js', 'next.config.ts', 'next.config.mjs'];

export function detectFramework(workspacePath: string): Framework {
  for (const configFile of NEXT_CONFIG_FILES) {
    if (fs.existsSync(path.join(workspacePath, configFile))) {
      return 'nextjs';
    }
  }
  return 'none';
}
