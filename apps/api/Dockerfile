FROM node:24-bookworm-slim

# prisma needs openssl, CI=true stops pnpm 11 from hanging on its build-approval prompt
RUN apt-get update -y \
  && apt-get install -y --no-install-recommends openssl ca-certificates \
  && rm -rf /var/lib/apt/lists/*
ENV CI=true
RUN corepack enable

WORKDIR /repo
COPY . .

# install only the api and what it depends on, pnpm-workspace.yaml carries allowBuilds
RUN pnpm install --frozen-lockfile --filter @repo/api...

# generate only needs a url to exist, not a reachable database
RUN DATABASE_URL=postgresql://build:build@localhost:5432/build pnpm --filter @repo/api db:generate

ENV NODE_ENV=production
WORKDIR /repo/apps/api
EXPOSE 4000
CMD ["./node_modules/.bin/tsx", "src/index.ts"]