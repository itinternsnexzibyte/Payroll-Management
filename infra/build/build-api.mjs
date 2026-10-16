// Bundles an API (and the shared @nexzi/server-core sources) into dist/ with esbuild.
// Third-party packages stay external (installed in node_modules); the generated Prisma client
// is kept external so its query-engine binary resolves next to it.
//
// Usage (from an API directory): node ../../infra/build/build-api.mjs src/server.ts scripts/bootstrap-admin.ts
import { build } from 'esbuild';
import { isAbsolute, resolve } from 'node:path';

const entries = process.argv.slice(2);
const root = resolve(import.meta.dirname, '../..');

await build({
  entryPoints: entries,
  outdir: 'dist',
  // Flat output (dist/server.js) keeps "../generated/client" pointing at the generated Prisma client.
  entryNames: '[name]',
  bundle: true,
  platform: 'node',
  target: 'node20',
  format: 'cjs',
  sourcemap: true,
  logLevel: 'info',
  alias: { '@nexzi/server-core': resolve(root, 'packages/server-core/src/index.ts') },
  plugins: [
    {
      name: 'externals',
      setup(b) {
        // Generated Prisma client: keep the relative require (dist/ and src/ are siblings).
        b.onResolve({ filter: /generated\/client$/ }, (args) => ({ path: args.path, external: true }));
        // Every bare package import except our workspace alias stays in node_modules.
        b.onResolve({ filter: /^[^./]/ }, (args) =>
          args.path.startsWith('@nexzi/') || isAbsolute(args.path) ? undefined : { path: args.path, external: true },
        );
      },
    },
  ],
});
