#!/bin/sh
# Restores a dump into an ISOLATED database and verifies it (ROADMAP E02.11).
# Usage: RESTORE_DATABASE_URL=postgresql://…/confluent_restore restore-check.sh /backups/db/confluent-<stamp>.dump
# Never point RESTORE_DATABASE_URL at production: the target is emptied first (--clean).
set -eu

DUMP="${1:?usage: restore-check.sh <dump file>}"
: "${RESTORE_DATABASE_URL:?RESTORE_DATABASE_URL is required (an isolated, disposable database)}"
if [ -n "${DATABASE_URL:-}" ] && [ "$RESTORE_DATABASE_URL" = "$DATABASE_URL" ]; then
  echo "refusing to restore over DATABASE_URL" >&2
  exit 2
fi
log() { printf '%s restore-check: %s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$*"; }
START=$(date +%s)

# 1. Integrity of the file itself.
( cd "$(dirname "$DUMP")" && sha256sum -c "$(basename "$DUMP").sha256" >/dev/null )
log "checksum ok"

# 2. Restore.
pg_restore --clean --if-exists --no-owner --no-privileges --exit-on-error \
  --dbname="$RESTORE_DATABASE_URL" "$DUMP"
log "restored in $(( $(date +%s) - START ))s"

# 3. Same row counts as at dump time.
psql "$RESTORE_DATABASE_URL" --no-psqlrc -v ON_ERROR_STOP=1 --tuples-only --no-align --field-separator='=' --quiet <<'SQL' > "$DUMP.restored-counts"
SELECT 'users', count(*) FROM users
UNION ALL SELECT 'dossiers', count(*) FROM dossiers
UNION ALL SELECT 'dossier_answers', count(*) FROM dossier_answers
UNION ALL SELECT 'documents', count(*) FROM documents
UNION ALL SELECT 'share_links', count(*) FROM share_links
UNION ALL SELECT 'questionnaire_fields', count(*) FROM questionnaire_fields
UNION ALL SELECT 'applied_migrations', count(*) FROM _prisma_migrations WHERE finished_at IS NOT NULL;
SQL
if ! diff -u "$DUMP.counts" "$DUMP.restored-counts"; then
  log "FAILED: row counts differ from the dump-time snapshot"
  exit 1
fi
log "row counts identical to the dump-time snapshot: $(tr '\n' ' ' < "$DUMP.counts")"

# 4. Referential sanity: every answer and document points to an existing dossier.
ORPHANS=$(psql "$RESTORE_DATABASE_URL" --no-psqlrc -v ON_ERROR_STOP=1 --tuples-only --no-align --quiet -c "
  SELECT (SELECT count(*) FROM dossier_answers a LEFT JOIN dossiers d ON d.id = a.dossier_id WHERE d.id IS NULL)
       + (SELECT count(*) FROM documents x LEFT JOIN dossiers d ON d.id = x.dossier_id WHERE d.id IS NULL)")
[ "$ORPHANS" = "0" ] || { log "FAILED: $ORPHANS orphan rows"; exit 1; }
log "no orphan answers or documents"
log "OK — total $(( $(date +%s) - START ))s"
