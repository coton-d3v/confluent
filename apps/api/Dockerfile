# Multi-stage production image for @confluent/api.
# Context expected: repository root (monorepo).
#
# Build:   docker build -f apps/api/Dockerfile --target prod \
#            --build-arg APP_VERSION=<x.y.z> -t confluent-api:<tag> .
# Run:     secrets are runtime configuration, never baked into the image (ROADMAP E02.09):
#            - DOPPLER_TOKEN set at run time → `doppler run` injects the secrets;
#            - otherwise the process reads plain environment variables (compose `environment:`).
# Layers:  deps    → install monorepo deps (cached)
#          build   → compile shared + generate prisma client + nest build
#          runtime → minimal final image (alpine + dist + prisma client)
#          prod    → runtime + doppler CLI, version bake, entrypoint using doppler when DOPPLER_TOKEN is set

FROM node:24-alpine AS deps
RUN corepack enable && corepack prepare pnpm@10.33.0 --activate
WORKDIR /repo
COPY pnpm-workspace.yaml pnpm-lock.yaml package.json ./
COPY apps/api/package.json apps/api/
COPY packages/shared/package.json packages/shared/
# `pnpm install` would run the api postinstall (`prisma generate`) and fail here
# because the schema file isn't copied yet. Skip it: the build stage runs it explicitly.
RUN pnpm install --frozen-lockfile --ignore-scripts

FROM deps AS build
WORKDIR /repo
COPY tsconfig.json ./
COPY packages/shared/ packages/shared/
COPY apps/api/ apps/api/
RUN pnpm --filter @confluent/shared build
RUN pnpm --filter @confluent/api exec prisma generate --schema=./prisma/schema.prisma
RUN pnpm --filter @confluent/api build

FROM node:24-alpine AS runtime
RUN corepack enable && corepack prepare pnpm@10.33.0 --activate \
 && apk add --no-cache openssl
WORKDIR /repo
ENV NODE_ENV=production
# Monorepo metadata (needed for `pnpm --filter` + workspace resolution at runtime).
COPY --from=build /repo/package.json /repo/pnpm-workspace.yaml /repo/pnpm-lock.yaml ./
COPY --from=build /repo/node_modules/ node_modules/
# Shared package — compiled output only.
COPY --from=build /repo/packages/shared/node_modules/ packages/shared/node_modules/
COPY --from=build /repo/packages/shared/dist/ packages/shared/dist/
COPY --from=build /repo/packages/shared/package.json packages/shared/
# API — dist, prisma assets, scripts (seed / admin helpers), and package.json.
COPY --from=build /repo/apps/api/node_modules/ apps/api/node_modules/
COPY --from=build /repo/apps/api/dist/ apps/api/dist/
COPY --from=build /repo/apps/api/prisma/ apps/api/prisma/
COPY --from=build /repo/apps/api/scripts/ apps/api/scripts/
COPY --from=build /repo/apps/api/src/modules/questionnaires/questionnaire.seed.ts apps/api/src/modules/questionnaires/
COPY --from=build /repo/apps/api/package.json apps/api/
EXPOSE 3000
CMD ["node", "apps/api/dist/main.js"]

FROM runtime AS prod
ARG APP_VERSION
ENV APP_VERSION=${APP_VERSION}
RUN wget -q -t3 'https://packages.doppler.com/public/cli/rsa.8004D9FF50437357.key' -O /etc/apk/keys/cli@doppler-8004D9FF50437357.rsa.pub \
 && echo 'https://packages.doppler.com/public/cli/alpine/any-version/main' | tee -a /etc/apk/repositories \
 && apk add --no-cache doppler
COPY apps/api/docker-entrypoint.sh /usr/local/bin/confluent-entrypoint
ENTRYPOINT ["/usr/local/bin/confluent-entrypoint"]
CMD ["node", "apps/api/dist/main.js"]
