/**
 * Writes the generated OpenAPI documents and an endpoint table to docs/.
 * Run from an API directory:  npx tsx ../../infra/scripts/export-openapi.ts <name>
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { AddressInfo } from 'node:net';
import { pathToFileURL } from 'node:url';

async function main() {
  const name = process.argv[2];
  const { createApp } = await import(pathToFileURL(resolve(process.cwd(), 'src/app.ts')).href);
  const server = createApp().listen(0);
  const port = (server.address() as AddressInfo).port;
  const spec = await (await fetch(`http://127.0.0.1:${port}/openapi.json`, { headers: { connection: 'close' } })).json();
  await new Promise((r) => server.close(r));
  const outDir = resolve(process.cwd(), '../../docs/openapi');
  mkdirSync(outDir, { recursive: true });
  writeFileSync(resolve(outDir, `${name}.json`), JSON.stringify(spec, null, 2));
  const rows: string[] = [];
  for (const [path, ops] of Object.entries(spec.paths as Record<string, Record<string, { tags: string[]; summary: string; description: string }>>)) {
    for (const [method, op] of Object.entries(ops)) {
      const perm = /permission \(any of\): (.*)/.exec(op.description)?.[1]?.replace(/`/g, '') ?? (op.description.includes('Public') ? 'public' : 'signed in');
      rows.push(`| ${op.tags[0]} | \`${method.toUpperCase()}\` | \`${path}\` | ${op.summary} | ${perm} |`);
    }
  }
  writeFileSync(resolve(outDir, `${name}-endpoints.md`), ['| Area | Method | Path | Purpose | Permission |', '|---|---|---|---|---|', ...rows].join('\n') + '\n');
  console.log(`${name}: ${rows.length} operations`);
  setTimeout(() => process.exit(0), 50);
}
main();
