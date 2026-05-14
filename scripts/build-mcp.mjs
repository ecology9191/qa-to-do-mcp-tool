import { chmod } from 'node:fs/promises';
import { build } from 'esbuild';

await build({
  entryPoints: ['src/bin/qa-to-do.ts'],
  outfile: 'dist-node/qa-to-do.js',
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node24',
  external: ['node:*'],
  logLevel: 'info'
});

await chmod('dist-node/qa-to-do.js', 0o755);
