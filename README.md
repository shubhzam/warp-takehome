# Time off tracker

A time off tracking API and the web console on top of it.

- policies with versions, tenure tiers and carryover caps
- an append-only hours ledger with monthly and payroll based accruals
- requests, approvals, cancellations and year-end expiry
- per employee work schedules and holiday calendars, so a request is priced by the server
- an admin console (policies, requests, employees, holidays, operations, audit log) and an employee page

## What is in the repo

| Path | What it is |
|---|---|
| `apps/api` | Express 5, Prisma 7 and PostgreSQL 18. Listens on port 4000 |
| `apps/web` | Next.js 16 console. Listens on port 3000 and forwards `/api/*` to the API |
| `packages/shared` | zod schemas used by both the API and the web forms |
| `packages/ui`, `packages/eslint-config`, `packages/typescript-config` | starter packages (the web app does not use `@repo/ui`) |
| `apps/docs` | one folder per feature with its planning, techspec and dataflow notes |

## Start it with Docker

You need Docker with Compose v2. The seed script also needs `bash`, `curl`, `jq` and `uuidgen`.

```sh
# build the images and start postgres, the api and the web console
docker compose up --build -d

# create the tables (needed once on a new database, and again after new migrations)
docker compose exec api ./node_modules/.bin/prisma migrate deploy

# make a demo company and print its id
bash apps/api/scripts/seed-demo.sh
```

Open http://localhost:3000 and fill the session form with the company id the seed printed:

| Session | User id | Role |
|---|---|---|
| Admin | `admin_1` | `ADMIN` |
| Employee | `emp_2201` | `EMPLOYEE` |
| Employee with a 6 hour week | `emp_2202` | `EMPLOYEE` |

| Service | Host port | Notes |
|---|---|---|
| web | 3000 | the console |
| api | 4000 | `GET /health` answers without headers |
| postgres | 5433 | user `warp`, password `warp`, database `timeoff` |

Things to know:

- Run the `migrate deploy` step before using the console. On an empty database the API answers `INTERNAL` because the tables do not exist yet.
- `docker compose up` does not rebuild an image that already exists. Use `--build` after pulling code.
- Every run of the seed script creates a new company. It also deletes the `emp_2201` and `emp_2202` assignments of earlier companies, so use the id from the latest run.
- `docker compose down` stops everything and keeps the data. `docker compose down -v` also wipes the database volume.
- The web image bakes the API address in at build time. Inside Compose it is `http://api:4000`, set by the `API_URL` build arg in `docker-compose.yml`.

## Run it locally for development

You need Node 24 or newer, pnpm 11 (`corepack enable`) and Docker for the database.

```sh
pnpm install
cp apps/api/.env.example apps/api/.env

# database only, the apps run on your machine
docker compose up -d postgres

# generate the prisma client and create the tables
pnpm --filter @repo/api db:generate
pnpm --filter @repo/api exec prisma migrate deploy

# terminal 1, the api on :4000
pnpm --filter @repo/api dev

# terminal 2, the console on :3000
pnpm --filter web dev
```

Then run the seed script as above and open http://localhost:3000.

Do not run the web container and `pnpm --filter web dev` together, both want port 3000.

## Configuration

| Variable | Used by | Default | Meaning |
|---|---|---|---|
| `DATABASE_URL` | api | none, required | PostgreSQL connection string |
| `PORT` | api | `4000` | API port |
| `NODE_ENV` | api | `development` | `development`, `test` or `production` |
| `DB_TIMEOUT_MS` | api | `2000` | how long the health check waits for the database |
| `API_URL` | web | `http://localhost:4000` | where `/api/*` is forwarded. Read at build time, so rebuild the web image to change it |

`apps/api/.env.example` has working values for the local setup above.

## The console

- The session is the three headers the API trusts: `x-company-id`, `x-user-id` and `x-role`. There is no login. It is kept in the browser and the shell says so on every page.
- Admin pages: Policies, Requests, Employees, Holidays, Operations and Audit log. An employee session that opens one sees an admin only screen.
- Employee page: My time off, with balances, the request form and the employee's own requests.
- The request form does not compute hours. It asks the API to price the chosen dates and shows the per day breakdown.

## Checks and tests

```sh
pnpm check-types              # every package, through turbo
pnpm --filter web lint
pnpm --filter web build
```

Pure checks, no server needed:

```sh
pnpm --filter @repo/api exec tsx scripts/tier-accrual-check.ts
pnpm --filter @repo/api exec tsx scripts/worked-accrual-check.ts
pnpm --filter @repo/api exec tsx scripts/schedule-check.ts
```

End to end walkthroughs, run from the repo root with the API up on port 4000 (they need `jq`, and most need `docker compose` for a few SQL checks):

```sh
bash apps/api/scripts/ledger-test.sh
bash apps/api/scripts/payroll-test.sh
bash apps/api/scripts/requests-test.sh
bash apps/api/scripts/tenure-test.sh
bash apps/api/scripts/workhours-test.sh
bash apps/api/scripts/yearend-test.sh
```

These scripts print a transcript with the expected result next to each step, they are not assertion suites. Read the output, do not rely on the exit code (`ledger-test.sh` ends with two statements that are supposed to fail). Each run uses a fresh company, and the dates are fixed around 2026-10-12, so some steps only make sense around that date.

## Troubleshooting

| Symptom | Cause and fix |
|---|---|
| The console stays on "Loading..." in development | You opened the dev server on a host other than `localhost`, such as `http://[::1]:3000` or a LAN address. Next blocks its hot reload socket for those hosts and the page never hydrates. Use `http://localhost:3000` or `http://127.0.0.1:3000`, or add the host to `DEV_ORIGINS` in `apps/web/next.config.js` and restart the dev server. A production build or the container is not affected |
| API answers `INTERNAL` / "something went wrong" | The tables are missing. Run the `prisma migrate deploy` step |
| API answers 404 for `/policies` or other routes | The API container is running an old image. Run `docker compose up --build -d` |
| `UNAUTHENTICATED` in the console | The company id must be a guid, and the user id must not be empty |
| `port is already allocated` or `EADDRINUSE` | Another process holds 3000, 4000 or 5433. Stop it, or change the host side of the `ports` entry in `docker-compose.yml` |
| Employee page says nothing is assigned | The seed script was run again and moved the demo assignments to the new company. Sign in with the newest company id |
