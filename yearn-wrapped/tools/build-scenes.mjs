import { build } from 'esbuild';
import { copyFile, rm } from 'node:fs/promises';

// Same pinned Three version, served locally with one shared scene chunk.
await rm('site/vendor/scene', { recursive: true, force: true });
await build({
  entryPoints: ['site/hero.js', 'site/boot3d.js'],
  outdir: 'site/vendor/scene',
  // The private preview serves assets with no-store. A stable shared filename
  // lets HTML preload the actual dependency without a build-time HTML manifest.
  chunkNames: 'shared',
  bundle: true,
  splitting: true,
  format: 'esm',
  platform: 'browser',
  target: 'es2022',
  minify: true,
  legalComments: 'linked',
  logLevel: 'info',
});
await copyFile('node_modules/three/LICENSE', 'site/vendor/scene/THREE-LICENSE.txt');
