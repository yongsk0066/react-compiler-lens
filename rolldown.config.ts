import { defineConfig } from 'rolldown';

export default defineConfig([
  {
    input: 'client/src/extension.ts',
    output: { file: 'dist/client/extension.js', format: 'cjs', sourcemap: true },
    external: ['vscode'],
    platform: 'node',
  },
  {
    input: 'server/src/index.ts',
    output: { file: 'dist/server/index.js', format: 'cjs', sourcemap: true },
    platform: 'node',
  },
]);
