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
