# Database migrations

The project uses Prisma Migrate. The `0_baseline` migration represents the
schema that existed before migration history was introduced.

## Safety rules

- Back up and verify a restore before changing a shared or production database.
- Never run the SQL in `0_baseline` against an existing database.
- Do not use `prisma db push` for shared or production databases after the
  baseline has been registered.
- Review generated SQL before running `prisma migrate deploy`.
- Run `prisma migrate reset` only against disposable development databases.

## Register an existing database

First confirm that the database schema matches `prisma/schema.prisma`. This is a
read-only comparison and exits with code `2` when differences exist:

```bash
yarn prisma migrate diff \
  --exit-code \
  --from-config-datasource \
  --to-schema prisma/schema.prisma
```

If differences exist, stop and reconcile them before continuing. Do not mark the
baseline as applied until the schemas match.

After a verified backup, register the baseline once:

```bash
yarn prisma migrate resolve --applied 0_baseline
yarn prisma migrate status
```

`migrate resolve` records the baseline in `_prisma_migrations`; it does not run
the baseline table-creation SQL.

For the first Plesk rollout, keep `DEPLOY_DATABASE_MODE=skip` while uploading
the source that contains `0_baseline`. Run the comparison and `migrate resolve`
over SSH, then change the mode to `migrate`. A normal migration deployment must
not run against an existing database before this one-time registration.

## New or empty database

For an empty database, apply the full migration history normally:

```bash
yarn prisma migrate deploy
```

The baseline creates the original schema, then later migrations are applied in
order.

## Deployments

Set `DEPLOY_DATABASE_MODE=migrate`. The deployment script will run:

```bash
yarn prisma migrate deploy
```

Do not use `DEPLOY_DATABASE_MODE=push` after adopting migration history.

## Student history backfill

After the history migration has been applied to a restored database copy, run
the command without flags first:

```bash
yarn db:backfill:student-history
```

This is a read-only dry-run. It prints counts and blocking issues without
writing data. Records are not guessed when their historical term does not match
the student's current classroom.

Only after reviewing a dry-run with zero blocking issues, enable writes with
both safety flags:

```bash
yarn db:backfill:student-history \
  --apply \
  --confirm=BACKFILL_STUDENT_HISTORY_V1
```

The command fills only missing values, refuses conflicting snapshots, and can be
run again safely.

After an applied backfill, compare every student's legacy score with the new
cumulative ledger:

```bash
yarn db:verify:student-scores
```

This command is read-only and exits unsuccessfully if a point account or
`pointDelta` is missing, or if any student's score differs by even one point.

## Disposable promotion E2E

Run the complete migration, backfill, score verification, term rollover, and
annual promotion flow against an isolated local database:

```bash
yarn test:promotion:e2e
```

The command refuses non-local database hosts. It creates a uniquely named
database, verifies promotion idempotency and unchanged historical records, and
drops the database in a `finally` block whether the test passes or fails. It
never writes to the database named in `DATABASE_URL`.
