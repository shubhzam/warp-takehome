FROM node:24-bookworm-slim

# CI=true stops pnpm 11 from hanging on its build-approval prompt
ENV CI=true
RUN corepack enable

WORKDIR /repo
COPY . .

# install only the web app and what it depends on, @repo/shared and @repo/ui come along as workspace links
RUN pnpm install --frozen-lockfile --filter web...

# next bakes the /api/* rewrite target into the build, so the api address has to be known here.
# inside the compose network the api answers on http://api:4000
ARG API_URL=http://api:4000
ENV API_URL=$API_URL
ENV NEXT_TELEMETRY_DISABLED=1
RUN pnpm --filter web build

ENV NODE_ENV=production
WORKDIR /repo/apps/web
EXPOSE 3000
CMD ["./node_modules/.bin/next", "start", "--port", "3000"]
