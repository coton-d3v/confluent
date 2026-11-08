#!/bin/sh
# Deploys the whole migration chain in ONE `prisma migrate deploy`, as a production deploy does, on a
# disposable database holding historical data that collides once turned into keys (code review
# R27–R29), then checks the result.
#
#   MIGRATION_CHECK_DATABASE_URL=postgresql://…/empty_db sh scripts/check-migration-chain.sh
#
# The database must be empty and disposable: it is filled and left as is for inspection.
set -eu
cd "$(dirname "$0")/.."
URL=${MIGRATION_CHECK_DATABASE_URL:?MIGRATION_CHECK_DATABASE_URL must point to an empty, disposable database}
if [ "$URL" = "${DATABASE_URL:-}" ]; then
  echo "Refused: MIGRATION_CHECK_DATABASE_URL equals DATABASE_URL." >&2
  exit 1
fi
FIRST_FORMS_MIGRATION=20261109010000

# 1. Migrations before the forms ones, from a copy of the migrations folder.
before=$(mktemp -d)
trap 'rm -rf "$before"' EXIT
cp prisma/schema.prisma "$before/"
mkdir "$before/migrations"
cp prisma/migrations/migration_lock.toml "$before/migrations/"
for dir in prisma/migrations/*/; do
  name=$(basename "$dir")
  [ "${name%%_*}" \< "$FIRST_FORMS_MIGRATION" ] && cp -r "$dir" "$before/migrations/"
done
DATABASE_URL=$URL npx prisma migrate deploy --schema "$before/schema.prisma" >/dev/null

# 2. Historical data, then every remaining migration at once.
psql -q -v ON_ERROR_STOP=1 "$URL" -f prisma/checks/forms-history.fixture.sql
DATABASE_URL=$URL npx prisma migrate deploy --schema prisma/schema.prisma

# 3. Expected keys and answers.
psql -q -v ON_ERROR_STOP=1 "$URL" -f prisma/checks/forms-history.assertions.sql
echo "Migration chain OK."
