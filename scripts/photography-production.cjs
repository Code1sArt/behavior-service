'use strict';
// Server-only release operations. Never print credentials, database rows, or dump contents.
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const cp = require('node:child_process');
const { pipeline } = require('node:stream/promises');
const { createGzip } = require('node:zlib');
require('dotenv').config({ quiet: true });
const mariadb = require('mariadb');
const migration = '20261105090000_photography_booking';

function command(name) {
  const result = cp.spawnSync('sh', ['-c', 'command -v "$1"', 'sh', name], {
    encoding: 'utf8',
  });
  return result.status === 0 ? result.stdout.trim() : null;
}
function releaseDirectory(id) {
  if (!/^\d+$/.test(id || '')) throw new Error('Invalid release identifier');
  return path.resolve(process.cwd(), `../private/photography-release-${id}`);
}
function databaseOptions() {
  if (!process.env.DATABASE_URL)
    throw new Error('Production database configuration is unavailable');
  const url = new URL(process.env.DATABASE_URL);
  return {
    host: url.hostname,
    port: Number(url.port) || 3306,
    user: decodeURIComponent(url.username),
    password: decodeURIComponent(url.password),
    database: url.pathname.slice(1),
    connectTimeout: 10000,
  };
}
async function connect() {
  return mariadb.createConnection(databaseOptions());
}
async function hasMigration(connection) {
  const rows = await connection.query(
    'SELECT migration_name FROM _prisma_migrations WHERE migration_name = ? AND finished_at IS NOT NULL AND rolled_back_at IS NULL',
    [migration],
  );
  return rows.length === 1;
}
async function inspect() {
  const connection = await connect();
  try {
    const [version] = await connection.query('SELECT VERSION() AS version');
    const tables = await connection.query('SHOW TABLES');
    const migrations = await connection.query(
      'SELECT migration_name, finished_at IS NOT NULL AS applied FROM _prisma_migrations ORDER BY started_at DESC LIMIT 3',
    );
    console.log(
      JSON.stringify(
        {
          node: process.version,
          databaseServer: version.version,
          tableCount: tables.length,
          migrations,
          flags: {
            photography: process.env.PHOTOGRAPHY_ENABLED === 'true',
            inbox: process.env.IN_APP_NOTIFICATIONS_ENABLED === 'true',
            push: process.env.PUSH_ENABLED === 'true',
            lineConfigured: !!process.env.LINE_CHANNEL_ACCESS_TOKEN,
          },
          tools: {
            mysqldump: command('mysqldump'),
            mariadbDump: command('mariadb-dump'),
          },
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
async function backup(id) {
  const directory = releaseDirectory(id);
  await fsp.mkdir(directory, { recursive: true, mode: 0o700 });
  await fsp.chmod(directory, 0o700);
  // Never replace an existing snapshot for a workflow re-run.
  if (fs.existsSync(path.join(directory, 'manifest.json')))
    throw new Error('A snapshot already exists for this workflow run');
  const connection = await connect();
  let photographyAlreadyMigrated;
  try {
    photographyAlreadyMigrated = await hasMigration(connection);
  } finally {
    await connection.end();
  }
  const temporary = await fsp.mkdtemp(
    path.join(os.tmpdir(), 'dsps-db-options-'),
  );
  const optionsFile = path.join(temporary, 'client.cnf');
  const quote = (value) =>
    `"${String(value).replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\n/g, '\\n').replace(/\r/g, '\\r')}"`;
  const config = databaseOptions();
  try {
    await fsp.writeFile(
      optionsFile,
      `[client]\nhost=${quote(config.host)}\nport=${config.port}\nuser=${quote(config.user)}\npassword=${quote(config.password)}\n`,
      { mode: 0o600 },
    );
    const executable = command('mariadb-dump') || command('mysqldump');
    if (!executable)
      throw new Error('No database backup executable is available');
    const child = cp.spawn(
      executable,
      [
        `--defaults-extra-file=${optionsFile}`,
        '--single-transaction',
        '--quick',
        '--skip-lock-tables',
        '--hex-blob',
        '--routines',
        '--events',
        '--no-tablespaces',
        config.database,
      ],
      { stdio: ['ignore', 'pipe', 'pipe'] },
    );
    // Provider stderr may contain connection details; keep it out of public CI logs.
    child.stderr.resume();
    const completed = new Promise((resolve, reject) => {
      child.once('error', reject);
      child.once('close', (code) =>
        code === 0
          ? resolve()
          : reject(new Error(`Database backup failed with exit code ${code}`)),
      );
    });
    await Promise.all([
      pipeline(
        child.stdout,
        createGzip(),
        fs.createWriteStream(path.join(directory, 'database.sql.gz'), {
          mode: 0o600,
        }),
      ),
      completed,
    ]);
    if (fs.existsSync('.env'))
      await fsp.copyFile('.env', path.join(directory, 'environment.backup'));
    if (fs.existsSync(path.join(directory, 'environment.backup')))
      await fsp.chmod(path.join(directory, 'environment.backup'), 0o600);
    if (fs.existsSync('dist')) {
      cp.execFileSync(
        'tar',
        ['-czf', path.join(directory, 'application-dist.tar.gz'), 'dist'],
        { stdio: 'ignore' },
      );
      await fsp.chmod(path.join(directory, 'application-dist.tar.gz'), 0o600);
    }
    const size = (await fsp.stat(path.join(directory, 'database.sql.gz'))).size;
    if (!size) throw new Error('The database snapshot is empty');
    await fsp.writeFile(
      path.join(directory, 'manifest.json'),
      JSON.stringify({
        id,
        createdAt: new Date().toISOString(),
        photographyAlreadyMigrated,
        compressedBytes: size,
      }),
      { mode: 0o600 },
    );
    console.log(
      JSON.stringify({
        snapshotCreated: true,
        release: id,
        compressedBytes: size,
        photographyAlreadyMigrated,
      }),
    );
  } finally {
    await fsp.rm(temporary, { recursive: true, force: true });
  }
}
async function exportSnapshot(id) {
  await pipeline(
    fs.createReadStream(path.join(releaseDirectory(id), 'database.sql.gz')),
    process.stdout,
  );
}
async function markVerified(id) {
  const directory = releaseDirectory(id);
  if (!fs.existsSync(path.join(directory, 'manifest.json')))
    throw new Error('The release snapshot is missing');
  await fsp.writeFile(
    path.join(directory, 'restore-verified.json'),
    JSON.stringify({ verifiedAt: new Date().toISOString() }),
    { mode: 0o600 },
  );
  console.log('Snapshot restore verified; release gate opened.');
}
async function enableIfNew(id) {
  const directory = releaseDirectory(id);
  if (!fs.existsSync(path.join(directory, 'restore-verified.json')))
    throw new Error('Snapshot restoration was not verified');
  const manifest = JSON.parse(
    await fsp.readFile(path.join(directory, 'manifest.json'), 'utf8'),
  );
  if (manifest.photographyAlreadyMigrated) {
    console.log(
      'Photography migration was already present; existing feature settings are preserved.',
    );
    return;
  }
  const connection = await connect();
  try {
    if (!(await hasMigration(connection)))
      throw new Error('Photography migration is not applied');
    const [lock] = await connection.query(
      'SELECT COUNT(*) AS count FROM PhotographyMutex WHERE id = 1',
    );
    const [departments] = await connection.query(
      'SELECT COUNT(*) AS count FROM PhotographyDepartment',
    );
    if (Number(lock.count) !== 1 || Number(departments.count) < 1)
      throw new Error('Photography initialization is incomplete');
  } finally {
    await connection.end();
  }
  // Plesk's unrelated environment settings stay intact. dotenv reads these on app restart.
  let content = fs.existsSync('.env') ? await fsp.readFile('.env', 'utf8') : '';
  for (const [key, value] of [
    ['PHOTOGRAPHY_ENABLED', 'true'],
    ['PHOTOGRAPHY_MINI_APP_URL', 'https://dspscare.com/photography'],
  ]) {
    const pattern = new RegExp(`^\\s*(?:export\\s+)?${key}\\s*=.*$`, 'gm');
    content = pattern.test(content)
      ? content.replace(pattern, `${key}=${JSON.stringify(value)}`)
      : `${content.trimEnd()}\n${key}=${JSON.stringify(value)}\n`;
  }
  const temporary = `.env.photography-release-${id}`;
  await fsp.writeFile(temporary, content, { mode: 0o600 });
  await fsp.rename(temporary, '.env');
  console.log(
    'Photography is enabled; notification provider settings are preserved.',
  );
}
async function smoke() {
  const { createHmac } = require('node:crypto');
  const connection = await connect();
  try {
    if (!process.env.JWT_SECRET)
      throw new Error('JWT configuration unavailable for release verification');
    const sign = (id) => {
      const header = Buffer.from(
        JSON.stringify({ alg: 'HS256', typ: 'JWT' }),
      ).toString('base64url');
      const payload = Buffer.from(
        JSON.stringify({ sub: id, exp: Math.floor(Date.now() / 1000) + 60 }),
      ).toString('base64url');
      return `${header}.${payload}.${createHmac('sha256', process.env.JWT_SECRET).update(`${header}.${payload}`).digest('base64url')}`;
    };
    const get = async (endpoint, id, expected = 200, method = 'GET') => {
      const response = await fetch(`https://api.dspscare.com${endpoint}`, {
        method,
        headers: id ? { Authorization: `Bearer ${sign(id)}` } : {},
        signal: AbortSignal.timeout(20000),
      });
      if (response.status !== expected)
        throw new Error(
          `Release check failed for ${endpoint}: HTTP ${response.status}`,
        );
      return expected === 200 || expected === 404 ? response.json() : null;
    };
    const [admin] = await connection.query(
      "SELECT id FROM User WHERE role = 'ADMIN' LIMIT 1",
    );
    const [student] = await connection.query(
      "SELECT id FROM User WHERE role = 'STUDENT' LIMIT 1",
    );
    if (!admin || !student)
      throw new Error('Release verification accounts are unavailable');
    await get('/health');
    if (process.env.PHOTOGRAPHY_ENABLED !== 'true') {
      console.log(
        'Production health passed; photography remains disabled by existing configuration.',
      );
      return;
    }
    const metadata = await get('/photography/metadata', admin.id);
    if (
      !metadata.canManage ||
      metadata.role !== 'ADMIN' ||
      !metadata.departments.length
    )
      throw new Error('Admin photography metadata is incomplete');
    await get('/photography/bookings', admin.id);
    await get('/photography/managers', admin.id);
    const studentMetadata = await get('/photography/metadata', student.id);
    if (studentMetadata.canManage || studentMetadata.canBook)
      throw new Error('Student photography permissions are incorrect');
    await get('/photography/bookings', student.id);
    await get('/photography/managers', student.id, 403);
    await get('/photography/metadata', null, 401);
    // Server-generated booking IDs are UUIDs. This non-UUID probe can never
    // match a real booking and verifies the DELETE handler without deleting data.
    const missingBooking = `/photography/bookings/release-smoke-missing-${require('node:crypto').randomUUID()}`;
    const missing = await get(missingBooking, admin.id, 404, 'DELETE');
    if (missing.message !== 'ไม่พบรายการจอง')
      throw new Error('Admin photography deletion route is unavailable');
    await get(missingBooking, student.id, 403, 'DELETE');
    await get(missingBooking, null, 401, 'DELETE');
    console.log(
      'Production smoke checks passed: health, admin photography, student access boundaries, admin-only deletion, and anonymous rejection. No business data was changed.',
    );
  } finally {
    await connection.end();
  }
}
async function rollback(id) {
  const directory = releaseDirectory(id);
  const archive = path.join(directory, 'application-dist.tar.gz');
  if (!fs.existsSync(archive))
    throw new Error('Previous application archive is unavailable');
  cp.execFileSync('tar', ['-tzf', archive], { stdio: 'ignore' });
  // Replace compiled application files; keep the additive database migration.
  await fsp.rm('dist', { recursive: true, force: true });
  cp.execFileSync('tar', ['-xzf', archive], { stdio: 'ignore' });
  const previousEnvironment = path.join(directory, 'environment.backup');
  if (fs.existsSync(previousEnvironment)) {
    await fsp.copyFile(previousEnvironment, '.env');
    await fsp.chmod('.env', 0o600);
  }
  await fsp.mkdir('tmp', { recursive: true });
  await fsp.writeFile('tmp/restart.txt', '');
  console.log(
    'Previous compiled API and environment restored; additive database changes retained.',
  );
}
async function main() {
  const [operation, id] = process.argv.slice(2);
  if (operation === 'inspect') return inspect();
  if (operation === 'backup') return backup(id);
  if (operation === 'export') return exportSnapshot(id);
  if (operation === 'verified') return markVerified(id);
  if (operation === 'enable-if-new') return enableIfNew(id);
  if (operation === 'smoke') return smoke();
  if (operation === 'rollback') return rollback(id);
  throw new Error('Unsupported production operation');
}
main().catch((error) => {
  console.error(
    'Production operation failed:',
    error.code || error.message || error.name,
  );
  process.exitCode = 1;
});
