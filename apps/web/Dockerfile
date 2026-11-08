# syntax=docker/dockerfile:1
# Multi-stage production image for @confluent/web.
# Context expected: repository root (monorepo).
#
# Build:   DOPPLER_TOKEN=<token> docker build -f apps/web/Dockerfile --target prod \
#            --secret id=DOPPLER_TOKEN,env=DOPPLER_TOKEN --build-arg APP_VERSION=<x.y.z> \
#            -t confluent-web:<tag> .
# The Doppler token is a BuildKit secret: mounted for the build command only, never written to a
# layer, the image metadata or the build cache (ROADMAP E02.09). VITE_* values are public by nature
# (they end up in the JS bundle).
# Layers:  deps  → install monorepo deps (cached)
#          build → compile shared + build vite bundle (doppler injects VITE_* at build)
#          prod  → nginx:alpine serving the static bundle

FROM node:24-alpine AS deps
RUN corepack enable && corepack prepare pnpm@10.33.0 --activate
WORKDIR /repo
COPY pnpm-workspace.yaml pnpm-lock.yaml package.json ./
COPY apps/web/package.json apps/web/
COPY packages/shared/package.json packages/shared/
RUN pnpm install --frozen-lockfile --ignore-scripts

FROM deps AS build
ARG APP_VERSION
ENV APP_VERSION=${APP_VERSION}
WORKDIR /repo
COPY tsconfig.json ./
COPY packages/shared/ packages/shared/
COPY apps/web/ apps/web/
RUN pnpm --filter @confluent/shared build
RUN apk add --no-cache curl gnupg \
 && curl -Ls --tlsv1.2 --proto "=https" --retry 3 https://cli.doppler.com/install.sh | sh
RUN --mount=type=secret,id=DOPPLER_TOKEN \
    DOPPLER_TOKEN="$(cat /run/secrets/DOPPLER_TOKEN)" doppler run -- pnpm --filter @confluent/web build

FROM nginx:alpine AS prod
COPY apps/web/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /repo/apps/web/dist/ /usr/share/nginx/html/
EXPOSE 80
CMD ["nginx", "-g", "daemon off;"]
