/**
 * apply-migrations.ts — applies supabase/migrations/*.sql in filename order.
 *
 * Needs a direct Postgres connection (DDL cannot go through PostgREST):
 *   SUPABASE_DB_URL=postgresql://postgres.<ref>:<password>@<pooler-host>:5432/postgres
 *
 * Each file is applied inside a transaction and recorded in
 * public.schema_migrations, so re-running is a no-op.
 */
import {readdirSync, readFileSync} from 'node:fs';
import {join} from 'node:path';
import {Client} from 'pg';

const MIGRATIONS_DIR = join(process.cwd(), 'supabase', 'migrations');

async function main() {
  const dbUrl = process.env.SUPABASE_DB_URL;
  if (!dbUrl) {
    console.error(
      'SUPABASE_DB_URL is not set.\n' +
        'Get it from Supabase → Project Settings → Database → Connection string (URI),\n' +
        'and put it in .env.local as SUPABASE_DB_URL=...',
    );
    process.exit(1);
  }

  const client = new Client({
    connectionString: dbUrl,
    ssl: {rejectUnauthorized: false},
  });
  await client.connect();

  await client.query(`
    create table if not exists public.schema_migrations (
      filename   text primary key,
      applied_at timestamptz not null default now()
    );
  `);

  const {rows: applied} = await client.query<{filename: string}>(
    'select filename from public.schema_migrations',
  );
  const done = new Set(applied.map(r => r.filename));

  const files = readdirSync(MIGRATIONS_DIR)
    .filter(f => f.endsWith('.sql'))
    .sort();

  let ran = 0;
  for (const file of files) {
    if (done.has(file)) {
      console.log(`  skip  ${file} (already applied)`);
      continue;
    }
    const sql = readFileSync(join(MIGRATIONS_DIR, file), 'utf8');
    process.stdout.write(`  apply ${file} ... `);
    try {
      await client.query('begin');
      await client.query(sql);
      await client.query(
        'insert into public.schema_migrations (filename) values ($1)',
        [file],
      );
      await client.query('commit');
      console.log('ok');
      ran++;
    } catch (err) {
      await client.query('rollback');
      console.log('FAILED');
      console.error(err);
      await client.end();
      process.exit(1);
    }
  }

  // Post-apply verification so a green run actually means something.
  const checks: Array<[string, string]> = [
    ['vendors', `select count(*)::int as n from public.vendors`],
    ['products', `select count(*)::int as n from public.products`],
    ['price_entries', `select count(*)::int as n from public.price_entries`],
    [
      'rls enabled on all 3',
      `select count(*)::int as n from pg_tables
       where schemaname='public' and tablename in ('vendors','products','price_entries')
         and rowsecurity`,
    ],
    [
      'realtime tables',
      `select count(*)::int as n from pg_publication_tables
       where pubname='supabase_realtime' and schemaname='public'`,
    ],
  ];

  console.log(`\n${ran} migration(s) applied. State:`);
  for (const [label, q] of checks) {
    const {rows} = await client.query<{n: number}>(q);
    console.log(`  ${label.padEnd(22)} ${rows[0].n}`);
  }

  await client.end();
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
