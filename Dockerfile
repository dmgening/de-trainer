# The production image: server bundle, both web builds and the server's runtime
# node_modules, laid out like nix/package.nix. The homelab apps host runs it
# under Podman behind Traefik (compose.yaml); CI publishes it from main
# (.github/workflows/image.yml).

ARG NODE_IMAGE=docker.io/library/node:22-bookworm-slim

FROM ${NODE_IMAGE} AS build
# better-sqlite3 12.x is pinned for Node 22. Its install script downloads a
# prebuilt addon and falls back to node-gyp, which needs a toolchain and takes
# Node's headers from the image instead of downloading them.
RUN apt-get update \
 && apt-get install -y --no-install-recommends python3 make g++ \
 && rm -rf /var/lib/apt/lists/*
ENV COREPACK_ENABLE_DOWNLOAD_PROMPT=0 \
    CI=true \
    npm_config_nodedir=/usr/local
RUN corepack enable
WORKDIR /src

# The store depends on the lockfile alone, so source edits reuse this layer.
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN pnpm fetch

COPY . .
RUN pnpm install --offline --frozen-lockfile \
 && pnpm build

# Drop devDependencies (vite, tsup, playwright, ...) once the bundles exist: a
# fresh production install, because `install --prod` over the full tree leaves
# the dev packages in node_modules/.pnpm. tsup bundles the workspace packages
# into dist/, so their links (into packages/, not shipped) would only dangle.
RUN rm -rf node_modules apps/*/node_modules packages/*/node_modules e2e/node_modules \
 && pnpm install --offline --prod --frozen-lockfile \
 && rm -rf node_modules/.pnpm/node_modules/@de-trainer apps/server/node_modules/@de-trainer


FROM ${NODE_IMAGE}
LABEL org.opencontainers.image.source="https://github.com/dmgening/de-trainer" \
      org.opencontainers.image.description="de-class: German trainer PWA and its Node server"

WORKDIR /app
COPY --from=build /src/package.json ./
COPY --from=build /src/node_modules ./node_modules
COPY --from=build /src/apps/server/package.json ./apps/server/
COPY --from=build /src/apps/server/dist ./apps/server/dist
COPY --from=build /src/apps/server/drizzle ./apps/server/drizzle
COPY --from=build /src/apps/server/node_modules ./apps/server/node_modules
COPY --from=build /src/apps/web/dist ./apps/web/dist

# The same commands as the Nix package. The server finds drizzle/ and the web
# builds relative to its dist/; configuration comes from the environment
# (apps/server/src/config.ts), so `exec <container> de-trainer-admin ...` sees
# the server's database.
RUN for cmd in server:main migrate:migrate admin:admin; do \
      f="/usr/local/bin/de-trainer-${cmd%%:*}"; \
      printf '#!/bin/sh\nexec node --enable-source-maps /app/apps/server/dist/%s.js "$@"\n' "${cmd#*:}" > "$f"; \
      chmod 755 "$f"; \
    done \
 && mkdir /data \
 && chown node:node /data

# prod demands ACCESS_TEAM_DOMAIN, ACCESS_AUD_USER and ACCESS_AUD_AGENT, so a
# container without them exits instead of serving without Access checks.
ENV APP_ENV=prod \
    HOST=0.0.0.0 \
    PORT=8080 \
    DATA_DIR=/data
USER node
EXPOSE 8080

# Migrations are additive (tech-spec), so the previous image still runs on a
# migrated database after a rollback. exec leaves node as PID 1 for SIGTERM.
CMD ["sh", "-c", "de-trainer-migrate && exec de-trainer-server"]
