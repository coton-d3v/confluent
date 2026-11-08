#!/bin/sh
# Applies the migrations with the migration account (code review R35). The account is chosen HERE,
# inside `doppler run` (see docker-entrypoint.sh), after the secrets were injected: a DATABASE_URL
# injected by Doppler (the application account) can no longer replace MIGRATION_DATABASE_URL.
set -eu
if [ -n "${MIGRATION_DATABASE_URL:-}" ]; then
  DATABASE_URL="$MIGRATION_DATABASE_URL"
  export DATABASE_URL
  echo "migrate-deploy: using MIGRATION_DATABASE_URL" >&2
else
  echo "migrate-deploy: MIGRATION_DATABASE_URL is not set, migrating with DATABASE_URL" >&2
fi
exec prisma migrate deploy --schema=./prisma/schema.prisma "$@"
