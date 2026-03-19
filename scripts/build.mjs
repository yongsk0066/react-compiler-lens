import * as esbuild from 'esbuild';

await esbuild.build({
  entryPoints: ['client/src/extension.ts'],
  bundle: true,
  outfile: 'dist/client/extension.js',
  format: 'cjs',
  platform: 'node',
  external: ['vscode'],
  sourcemap: true,
});

await esbuild.build({
  entryPoints: ['server/src/index.ts'],
  bundle: true,
  outfile: 'dist/server/index.js',
  format: 'cjs',
  platform: 'node',
  external: [
    '@babel/core',
    '@babel/parser',
    '@babel/types',
    'babel-plugin-react-compiler',
    'vscode-languageserver',
    'vscode-languageserver-textdocument',
  ],
  sourcemap: true,
});
