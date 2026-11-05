'use strict';
// Run through the authenticated production workflow. Never print credentials or row data.
const fs = require('node:fs');
const path = require('node:path');
const cp = require('node:child_process');
require('dotenv').config({ quiet: true });
const mariadb = require('mariadb');

function command(name) {
  const result = cp.spawnSync('sh', ['-c', 'command -v "$1"', 'sh', name], {
    encoding: 'utf8',
  });
  return result.status === 0 ? result.stdout.trim() : null;
}
async function main() {
  if (process.argv[2] !== 'inspect')
    throw new Error('Unsupported production operation');
  if (!process.env.DATABASE_URL)
    throw new Error('DATABASE_URL is unavailable to the production workflow');
  const url = new URL(process.env.DATABASE_URL);
  const connection = await mariadb.createConnection({
    host: url.hostname,
    port: Number(url.port) || 3306,
    user: decodeURIComponent(url.username),
    password: decodeURIComponent(url.password),
    database: url.pathname.slice(1),
    connectTimeout: 10000,
  });
  try {
    const [version] = await connection.query('SELECT VERSION() AS version');
    const tables = await connection.query('SHOW TABLES');
    const migrations = await connection.query(
      'SELECT migration_name, finished_at IS NOT NULL AS applied FROM _prisma_migrations ORDER BY started_at DESC LIMIT 3',
    );
    const roles = await connection.query(
      'SELECT role, COUNT(*) AS count FROM User GROUP BY role',
    );
    console.log(
      JSON.stringify(
        {
          node: process.version,
          databaseServer: version.version,
          tables: tables.length,
          migrations,
          roles: roles.map((r) => ({ role: r.role, count: Number(r.count) })),
          flags: {
            photography: process.env.PHOTOGRAPHY_ENABLED === 'true',
            inbox: process.env.IN_APP_NOTIFICATIONS_ENABLED === 'true',
            push: process.env.PUSH_ENABLED === 'true',
            lineConfigured: !!process.env.LINE_CHANNEL_ACCESS_TOKEN,
          },
          tools: {
            mysqldump: command('mysqldump'),
            mariadbDump: command('mariadb-dump'),
            mysql: command('mysql'),
            mariadb: command('mariadb'),
            gzip: command('gzip'),
          },
          backupParent: path.resolve(process.cwd(), '../private'),
        },
        null,
        2,
      ),
    );
    cp.execFileSync('df', ['-Pk', process.cwd()], { stdio: 'inherit' });
  } finally {
    await connection.end();
  }
}
main().catch((error) => {
  console.error('Production inspection failed:', error.code || error.name);
  process.exitCode = 1;
});
