import { build } from 'esbuild';
await build({
  entryPoints: ['tools/walletconnect.js'],
  outfile: 'site/vendor/walletconnect.js',
  bundle: true,
  format: 'esm',
  platform: 'browser',
  target: 'es2022',
  minify: true,
  legalComments: 'linked',
  define: { 'process.env.NODE_ENV': '"production"' },
  logLevel: 'info',
});
