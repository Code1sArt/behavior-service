# CI/CD to Plesk

This project deploys with GitHub Actions over SSH/rsync.

## Plesk setup

1. Create a Node.js application in Plesk.
2. Set the application root to the same folder used by `PLESK_DEPLOY_PATH`.
3. Set the startup file to `dist/src/main.js`, or set the start command to `yarn start:prod` if your Plesk panel supports commands.
4. Add production environment variables in Plesk:
   - `NODE_ENV=production`
   - `DATABASE_URL`
   - `JWT_SECRET`
   - `PORT`
   - `LINE_CHANNEL_ACCESS_TOKEN`
   - `LINE_LOGIN_CHANNEL_ID`
   - `LINE_LOGIN_CHANNEL_SECRET`
   - `DEPLOY_DATABASE_MODE`
   - `DEPLOY_APP_MODE`
5. Make sure SSH access is enabled for the subscription user.

The deploy script reads `.nvmrc` and automatically adds the matching Plesk
Node.js installation to `PATH`. To override the detected location, set:

```bash
NODE_BIN_DIR=/opt/plesk/node/24/bin
```

Adjust `24` to the Node version installed in Plesk.

## GitHub secrets

Add these secrets in GitHub repository settings:

```text
PLESK_HOST=example.com
PLESK_PORT=22
PLESK_USER=ssh-user
PLESK_SSH_KEY=<private deploy key>
PLESK_DEPLOY_PATH=/var/www/vhosts/dspscare.com/behavior-service
HEALTHCHECK_URL=https://api.example.com
```

`HEALTHCHECK_URL` is the optional service base URL. The workflow checks its
public `/health` endpoint. A legacy value ending in `/docs` is normalized
automatically, so disabling Swagger does not break deployment.

## Deployment mode

Plesk custom variables are available to the Node.js application but may not be
exported to the non-interactive SSH session used by GitHub Actions. Therefore
the deployment gates are stored in the non-secret
`scripts/deploy-mode.env` file:

- `migrate`: runs `prisma migrate deploy` only when `prisma/migrations` exists.
- `baseline`: verifies the legacy schema and registers `0_baseline`.
- `backfill-dry-run`: reports the history backfill plan without writing data.
- `backfill-apply`: applies the guarded backfill, verifies scores, and repeats
  the dry-run.
- `skip`: does not update the database.

This repository has a Prisma Migrate history beginning with `0_baseline`.
Before the first deployment to an existing database, follow
[`database-migrations.md`](database-migrations.md) and register the baseline.
Keep `DEPLOY_DATABASE_MODE=skip` until that registration is complete. Afterwards,
set it permanently to `migrate`; do not use `push` for shared or production
databases.

`DEPLOY_APP_MODE` controls whether the uploaded source replaces the running
application:

- `prepare`: install dependencies, generate Prisma Client, and perform the
  selected database action without rebuilding or restarting the app. The
  currently deployed `dist` keeps serving traffic.
- `release`: complete the build and restart after preparation checks pass.

The first migration rollout must use the staged procedure in
[`production-rollout.md`](production-rollout.md).

## Deploy flow

On push to `main` or `master`, GitHub Actions will:

1. Install dependencies.
2. Generate Prisma Client.
3. Run tests.
4. Build the NestJS app.
5. Upload source files to Plesk with rsync.
6. Run `scripts/plesk-deploy.sh` on the server.
7. Run the optional health check.
