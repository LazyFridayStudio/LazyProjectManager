# One image containing the API, the worker and the built web client.
#
# The API serves the web UI itself, so a self-hosted install is a single service
# on a single port with no reverse proxy to configure and no CORS to get wrong.
# The same image runs the outbox worker when started with a different command.

# --- build -------------------------------------------------------------------
FROM node:22-alpine AS build

ENV PNPM_HOME=/pnpm
ENV PATH=$PNPM_HOME:$PATH
# Without this pnpm treats the build as interactive and prompts, which a
# non-TTY answers with the default rather than failing visibly.
ENV CI=true
RUN corepack enable

WORKDIR /build

# Manifests first, so a source-only change reuses the cached dependency layer.
COPY pnpm-workspace.yaml pnpm-lock.yaml package.json .npmrc ./
COPY app/Shared/package.json ./app/Shared/
COPY app/Database/package.json ./app/Database/
COPY app/Server/package.json ./app/Server/
COPY app/Client/package.json ./app/Client/

RUN --mount=type=cache,id=pnpm-store,target=/pnpm/store \
    pnpm install --frozen-lockfile

COPY . .

RUN pnpm build

# --- runtime -----------------------------------------------------------------
FROM node:22-alpine AS runtime

# tini reaps zombies and forwards SIGTERM, so `docker compose down` drains
# in-flight requests instead of severing them.
RUN apk add --no-cache tini

# Stamped by the release workflow from the git tag. Reported by /health and on
# the connect screen, so an operator can tell which build they are looking at.
ARG APP_VERSION=0.0.0-dev
ENV APP_VERSION=$APP_VERSION

ENV NODE_ENV=production
ENV HOST=0.0.0.0
ENV PORT=3000
# The API serves the client from here.
ENV WEB_ROOT=/app/web
# A fresh install has an empty database; upgrading brings the schema forward.
ENV RUN_MIGRATIONS_ON_BOOT=true

WORKDIR /app

# Whole directories rather than a hand-picked list of dist folders. Each
# workspace package needs its package.json for Node to resolve its `exports`,
# and the pnpm symlinks in node_modules only resolve if the directories they
# point at are all present. The extra weight is TypeScript source text.
COPY --from=build /build/package.json /build/pnpm-workspace.yaml ./
COPY --from=build /build/node_modules ./node_modules
COPY --from=build /build/app/Shared ./app/Shared
COPY --from=build /build/app/Database ./app/Database
COPY --from=build /build/app/Server ./app/Server

# Only the built client, not the whole Client workspace: its node_modules
# carries Vite and the React toolchain, none of which the server needs.
COPY --from=build /build/app/Client/dist ./web

# node:alpine ships an unprivileged `node` user. Running as root would mean a
# path-traversal bug in static file serving could read the whole filesystem.
USER node

EXPOSE 3000

# Liveness only. It must not depend on Postgres or Redis, or a briefly slow
# dependency would get the container restarted.
HEALTHCHECK --interval=15s --timeout=3s --start-period=40s --retries=3 \
    CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||3000)+'/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

ENTRYPOINT ["/sbin/tini", "--"]
CMD ["node", "app/Server/dist/index.js"]
