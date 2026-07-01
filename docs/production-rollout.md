# Production rollout: student history and promotions

This is a one-time staged rollout for an existing production database. Do not
push either repository to `main` until the backup and Plesk variables below are
ready, because both repositories deploy automatically from `main`.

## Release order

1. Freeze data changes and create a verified database backup.
2. Upload backend source in prepare mode without changing the database.
3. Register the baseline migration.
4. Apply additive migrations while the old backend keeps running.
5. Dry-run and apply the history backfill, then verify every score.
6. Release and smoke-test the new backend.
7. Release and smoke-test the Admin frontend.

The Admin frontend must be released last.

## Gate 1: backup and configuration

- Schedule a maintenance window and ask staff not to record attendance or
  behavior during baseline/backfill.
- Create a full Plesk database backup.
- Restore that backup to a disposable database and confirm it opens.
- Record the current backend and frontend commit IDs for application rollback.
- Confirm the backend health-check URL and Plesk restart method.
- Confirm `scripts/deploy-mode.env` contains:

```text
DEPLOY_DATABASE_MODE=skip
DEPLOY_APP_MODE=prepare
```

Stop if the backup restore has not been verified.

## Gate 2: upload migration tooling without restarting

Push the reviewed backend release commit to `main`, or manually dispatch its
workflow. The prepare deployment uploads source and installs dependencies, but
keeps the existing `dist` and running process unchanged.

SSH to the backend application directory and inspect migration state:

```bash
yarn prisma migrate status
```

For an existing database that predates Prisma Migrate, register the original
schema exactly once:

```bash
yarn prisma migrate resolve --applied 0_baseline
yarn prisma migrate status
```

Do not run `migrate deploy` if the baseline registration fails or if production
already contains only part of the new history/promotion schema.

## Gate 3: additive migration

Change `scripts/deploy-mode.env` to:

```text
DEPLOY_DATABASE_MODE=migrate
DEPLOY_APP_MODE=prepare
```

Dispatch the backend workflow again. It applies the two additive migrations but
does not rebuild or restart the application. Confirm:

```bash
yarn prisma migrate status
```

All three migrations must be marked applied.

## Gate 4: backfill and score verification

Keep staff writes frozen. Run the read-only dry-run:

```bash
yarn db:backfill:student-history
```

Stop if `blockingIssues` is not zero. Save the complete output with the release
record.

Apply only after reviewing the counts:

```bash
yarn db:backfill:student-history \
  --apply \
  --confirm=BACKFILL_STUDENT_HISTORY_V1
```

Verify every cumulative score:

```bash
yarn db:verify:student-scores
```

The number of matched students must equal the number of students and
`blockingIssues` must be zero. Run the backfill dry-run once more; all
`*ToCreate` and `*ToUpdate` counts must now be zero.

## Gate 5: backend release

Change `scripts/deploy-mode.env` to:

```text
DEPLOY_DATABASE_MODE=migrate
DEPLOY_APP_MODE=release
```

Dispatch the backend workflow. Confirm the health check and then smoke-test:

- Admin login still works.
- Existing student summaries and behavior history load.
- Attendance history still shows its original room and term.
- `POST /promotions/term-rollover/preview` works for an administrator and does
  not write data.
- A non-admin receives `403` from promotion endpoints.

Do not Apply an actual promotion as a smoke test.

## Gate 6: Admin frontend release

Confirm the production `VITE_API_URL` points to the released backend, then push
the Admin release commit to `main`. Verify:

- The menu contains **เลื่อนชั้น / เปลี่ยนเทอม**.
- Terms and source classrooms load.
- Preview shows student names and blocking issues.
- Apply remains disabled when Preview has an issue or becomes stale.

Staff can resume normal writes after these checks pass.

## Rollback

The database changes are additive. If the new application fails after Gate 5,
redeploy the recorded previous backend/frontend commits and keep the new tables
and nullable snapshot columns. Do not manually drop the migration tables or
columns during an incident.

If migration or backfill fails before the new app is released, leave
`DEPLOY_APP_MODE=prepare`, keep the old app running, preserve logs, and diagnose
before retrying. Restore the verified backup only when data was partially
changed and cannot be reconciled; this decision must include all writes made
after the backup.
