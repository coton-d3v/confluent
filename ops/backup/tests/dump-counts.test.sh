#!/bin/sh
# Regression test for R34: counts describe the dump's snapshot even when rows are written right after
# (the former counts were queried afterwards, on another connection).
#   BACKUP_TEST_DATABASE_URL=postgresql://…/empty_disposable_db sh ops/backup/tests/dump-counts.test.sh
set -eu
URL="${BACKUP_TEST_DATABASE_URL:?BACKUP_TEST_DATABASE_URL must point to an empty, disposable database}"
HERE=$(cd "$(dirname "$0")/.." && pwd)
WORK=$(mktemp -d)
trap 'rm -rf "$WORK"' EXIT
psql -q -v ON_ERROR_STOP=1 "$URL" <<'SQL'
DROP TABLE IF EXISTS users, _prisma_migrations;
CREATE TABLE users (id TEXT PRIMARY KEY, email TEXT);
CREATE TABLE _prisma_migrations (id TEXT PRIMARY KEY, migration_name TEXT, finished_at TIMESTAMP);
INSERT INTO users VALUES ('u-1', 'a@x.fr');
INSERT INTO _prisma_migrations VALUES ('m-1', 'one', now()), ('m-2', 'failed', NULL);
SQL
pg_dump --format=custom --file="$WORK/test.dump" "$URL"
# A write lands after the dump, before counts would have been queried by the former script.
psql -q -v ON_ERROR_STOP=1 "$URL" -c "INSERT INTO users VALUES ('u-2', 'b@x.fr')"
counts=$(sh "$HERE/dump-counts.sh" "$WORK/test.dump")
expected="users=1
dossiers=0
dossier_answers=0
documents=0
share_links=0
questionnaire_fields=0
applied_migrations=1"
if [ "$counts" = "$expected" ]; then echo "dump-counts: ok (counts match the dump's snapshot)"; else
  echo "dump-counts: FAIL"; echo "$counts"; exit 1; fi
