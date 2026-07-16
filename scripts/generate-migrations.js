/* eslint-disable */
/**
 * One-off generator: snapshots the current `tasemkl` schema into baseline
 * knex migrations (one CREATE TABLE file per table).
 *
 * Usage: node scripts/generate-migrations.js
 *
 * Connection is read from .env (same vars used by knexfile.ts development).
 */
const fs = require('fs');
const path = require('path');
require('dotenv').config();

const Knex = require('knex');

const OUT_DIR = path.resolve(__dirname, '..', 'migrations');

// Tables managed by knex itself — never snapshot these.
const SKIP = new Set(['knex_migrations', 'knex_migrations_lock', 'sysdiagrams']);

const knex = Knex({
  client: 'mssql',
  connection: {
    server: process.env.SSMS_SERVER,
    user: process.env.SSMS_USER,
    password: process.env.SSMS_PASSWORD,
    database: process.env.SSMS_DB,
    port: Number(process.env.SSMS_PORT),
    options: { encrypt: false, enableArithAbort: true },
    requestTimeout: 60000,
  },
});

// Returns the per-table column definition block (without CREATE/parens/PK).
const COLUMN_DDL_SQL = `
SELECT
  t.name AS table_name,
  STRING_AGG(
    CAST(
      '  [' + c.name + '] ' +
      tp.name +
      CASE
        WHEN tp.name IN ('varchar','char','varbinary','binary')
          THEN '(' + IIF(c.max_length = -1, 'MAX', CAST(c.max_length AS VARCHAR(10))) + ')'
        WHEN tp.name IN ('nvarchar','nchar')
          THEN '(' + IIF(c.max_length = -1, 'MAX', CAST(c.max_length/2 AS VARCHAR(10))) + ')'
        WHEN tp.name IN ('decimal','numeric')
          THEN '(' + CAST(c.precision AS VARCHAR(10)) + ',' + CAST(c.scale AS VARCHAR(10)) + ')'
        WHEN tp.name IN ('datetime2','time','datetimeoffset') AND c.scale <> 7
          THEN '(' + CAST(c.scale AS VARCHAR(10)) + ')'
        ELSE ''
      END +
      CASE WHEN c.is_identity = 1 THEN ' IDENTITY(1,1)' ELSE '' END +
      CASE WHEN c.is_nullable = 0 THEN ' NOT NULL' ELSE ' NULL' END +
      CASE WHEN dc.definition IS NOT NULL THEN ' DEFAULT ' + dc.definition ELSE '' END
    AS NVARCHAR(MAX)),
    ',' + CHAR(10)
  ) WITHIN GROUP (ORDER BY c.column_id) AS cols
FROM sys.tables t
JOIN sys.columns c ON c.object_id = t.object_id
JOIN sys.types tp ON tp.user_type_id = c.user_type_id
LEFT JOIN sys.default_constraints dc ON dc.object_id = c.default_object_id
WHERE t.is_ms_shipped = 0
GROUP BY t.name
ORDER BY t.name;
`;

const PK_SQL = `
SELECT t.name AS table_name, i.name AS pk_name,
  STRING_AGG('[' + c.name + ']', ',') WITHIN GROUP (ORDER BY ic.key_ordinal) AS pk_cols
FROM sys.tables t
JOIN sys.indexes i ON i.object_id = t.object_id AND i.is_primary_key = 1
JOIN sys.index_columns ic ON ic.object_id = t.object_id AND ic.index_id = i.index_id
JOIN sys.columns c ON c.object_id = t.object_id AND c.column_id = ic.column_id
WHERE t.is_ms_shipped = 0
GROUP BY t.name, i.name;
`;

function fileHeader() {
  return `import type { Knex } from 'knex';\n\n`;
}

function buildFile(table, cols, pk) {
  let body = cols;
  if (pk) {
    body += `,\n  CONSTRAINT [${pk.pk_name}] PRIMARY KEY (${pk.pk_cols})`;
  }
  const createSql = `CREATE TABLE [dbo].[${table}] (\n${body}\n);`;
  return (
    fileHeader() +
    `export async function up(knex: Knex): Promise<void> {\n` +
    `  await knex.schema.raw(\`${createSql}\`);\n` +
    `}\n\n` +
    `export async function down(knex: Knex): Promise<void> {\n` +
    `  await knex.schema.raw('DROP TABLE IF EXISTS [dbo].[${table}];');\n` +
    `}\n`
  );
}

(async () => {
  try {
    if (!fs.existsSync(OUT_DIR)) fs.mkdirSync(OUT_DIR, { recursive: true });

    const colRows = await knex.raw(COLUMN_DDL_SQL);
    const pkRows = await knex.raw(PK_SQL);

    const columns = colRows; // mssql driver returns rows array directly
    const pkMap = new Map();
    for (const r of pkRows) pkMap.set(r.table_name, r);

    const tables = columns
      .map((r) => r.table_name)
      .filter((t) => !SKIP.has(t))
      .sort((a, b) => a.localeCompare(b));

    const base = 20260618000000;
    let i = 0;
    let written = 0;
    for (const table of tables) {
      i += 1;
      const row = columns.find((r) => r.table_name === table);
      if (!row || !row.cols) {
        console.warn(`skip ${table}: no columns`);
        continue;
      }
      const stamp = String(base + i);
      const slug = table.toLowerCase();
      const fileName = `${stamp}_create_${slug}.ts`;
      const content = buildFile(table, row.cols, pkMap.get(table));
      fs.writeFileSync(path.join(OUT_DIR, fileName), content, 'utf8');
      written += 1;
    }

    console.log(`Generated ${written} migration files in ${OUT_DIR}`);
  } catch (err) {
    console.error('Generation failed:', err);
    process.exitCode = 1;
  } finally {
    await knex.destroy();
  }
})();
