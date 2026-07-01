import mariadb from 'mariadb';

const databaseUrl = new URL(process.env.DATABASE_URL as string);
const databaseName = databaseUrl.pathname.slice(1);

const expectedLegacyTables = [
  'AcademicHoliday',
  'AcademicTerm',
  'AttendanceRecord',
  'BehaviorRecord',
  'Classroom',
  'PointCategory',
  'SystemConfig',
  'User',
  '_ClassroomAdvisors',
];

const newTables = [
  'PromotionBatch',
  'PromotionItem',
  'StudentEnrollment',
  'StudentPointAccount',
];

const newColumns = [
  ['AttendanceRecord', 'classroomId'],
  ['BehaviorRecord', 'classroomId'],
  ['BehaviorRecord', 'pointDelta'],
  ['BehaviorRecord', 'termId'],
] as const;

async function main() {
  const connection = await mariadb.createConnection({
    host: databaseUrl.hostname,
    port: Number(databaseUrl.port) || 3306,
    user: decodeURIComponent(databaseUrl.username),
    password: decodeURIComponent(databaseUrl.password),
    database: databaseName,
  });

  try {
    const tableRows = await connection.query<Array<{ tableName: string }>>(
      `SELECT TABLE_NAME AS tableName
       FROM information_schema.TABLES
       WHERE TABLE_SCHEMA = ?`,
      [databaseName],
    );
    const tableNames = new Set(tableRows.map((row) => row.tableName));
    const missingLegacyTables = expectedLegacyTables.filter(
      (table) => !tableNames.has(table),
    );
    const unexpectedNewTables = newTables.filter((table) =>
      tableNames.has(table),
    );

    const columnRows = await connection.query<
      Array<{ tableName: string; columnName: string }>
    >(
      `SELECT TABLE_NAME AS tableName, COLUMN_NAME AS columnName
       FROM information_schema.COLUMNS
       WHERE TABLE_SCHEMA = ?`,
      [databaseName],
    );
    const columns = new Set(
      columnRows.map((row) => `${row.tableName}.${row.columnName}`),
    );
    const unexpectedNewColumns = newColumns
      .map(([table, column]) => `${table}.${column}`)
      .filter((column) => columns.has(column));

    const issues = [
      ...missingLegacyTables.map((table) => `missing legacy table: ${table}`),
      ...unexpectedNewTables.map(
        (table) => `new table already exists before baseline: ${table}`,
      ),
      ...unexpectedNewColumns.map(
        (column) => `new column already exists before baseline: ${column}`,
      ),
    ];

    console.log(
      JSON.stringify(
        {
          database: databaseName,
          legacyTablesChecked: expectedLegacyTables.length,
          blockingIssues: issues.length,
          issues,
        },
        null,
        2,
      ),
    );

    if (issues.length > 0) {
      throw new Error(
        'Production baseline preflight failed; database may be incomplete or partially migrated.',
      );
    }
  } finally {
    await connection.end();
  }
}

void main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(message);
  process.exitCode = 1;
});
