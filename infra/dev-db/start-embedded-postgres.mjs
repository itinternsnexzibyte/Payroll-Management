// Development-only PostgreSQL launcher for machines without Docker.
// Runs a real PostgreSQL 17 server (binaries from the `embedded-postgres` npm package)
// with its data directory in ./.data/postgres. Never use this in production.
//
// Usage: npm run db:start   (keep the terminal open; Ctrl+C stops the server)
import EmbeddedPostgres from 'embedded-postgres';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';

if (process.env.NODE_ENV === 'production') {
  console.error('Refusing to start the embedded development database with NODE_ENV=production.');
  process.exit(1);
}

const port = Number(process.env.DEV_PG_PORT ?? 5433);
const user = process.env.DEV_PG_USER ?? 'nexzi_dev';
const password = process.env.DEV_PG_PASSWORD ?? 'nexzi_dev_only';
const databaseDir = resolve(process.cwd(), '.data/postgres');
const databases = ['payroll', 'payroll_test'];

const pg = new EmbeddedPostgres({ databaseDir, user, password, port, persistent: true, onLog: () => {} });

if (!existsSync(resolve(databaseDir, 'PG_VERSION'))) {
  console.log(`Initialising new development cluster in ${databaseDir}`);
  await pg.initialise();
}
await pg.start();

const client = pg.getPgClient();
await client.connect();
const existing = new Set((await client.query('SELECT datname FROM pg_database')).rows.map((r) => r.datname));
for (const db of databases) {
  if (!existing.has(db)) {
    await client.query(`CREATE DATABASE ${db}`);
    console.log(`Created database ${db}`);
  }
}
await client.end();

console.log(`PostgreSQL (development) listening on localhost:${port} — databases: ${databases.join(', ')}`);
console.log('Press Ctrl+C to stop.');

const shutdown = async () => {
  console.log('Stopping PostgreSQL...');
  await pg.stop();
  process.exit(0);
};
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
setInterval(() => {}, 1 << 30);
