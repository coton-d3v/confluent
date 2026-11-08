#!/bin/sh
# Nightly backup of Confluent (ROADMAP E02.10): PostgreSQL dump + document objects, local retention,
# off-server copy. Exits non-zero on any failure so the scheduler / monitoring sees it.
#
# Environment:
#   DATABASE_URL            required — database to dump (read-only use)
#   BACKUP_DIR              default /backups
#   BACKUP_RETENTION_DAYS   default 30 — local dumps and document archives older than this are pruned
#   DOCUMENTS_REMOTE        optional rclone source of the document bucket, e.g. "documents:confluent-prod"
#   BACKUP_OFFSITE_REMOTE   optional rclone destination off the server, e.g. "offsite:confluent-backups"
#   rclone remotes are configured with RCLONE_CONFIG_<NAME>_* variables (see docs/deploiement.md).
set -eu

: "${DATABASE_URL:?DATABASE_URL is required}"
BACKUP_DIR="${BACKUP_DIR:-/backups}"
RETENTION="${BACKUP_RETENTION_DAYS:-30}"
STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
DB_DIR="$BACKUP_DIR/db"
log() { printf '%s backup: %s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$*"; }

mkdir -p "$DB_DIR"
umask 077

# 1. Database: custom-format dump, checked readable before it replaces anything.
TMP="$DB_DIR/.confluent-$STAMP.dump.partial"
DUMP="$DB_DIR/confluent-$STAMP.dump"
log "dumping database"
pg_dump --format=custom --no-owner --no-privileges --file="$TMP" "$DATABASE_URL"
pg_restore --list "$TMP" >/dev/null
mv "$TMP" "$DUMP"
( cd "$DB_DIR" && sha256sum "$(basename "$DUMP")" > "$(basename "$DUMP").sha256" )

# Row counts at dump time: the restore check compares against them.
psql "$DATABASE_URL" --no-psqlrc --tuples-only --no-align --field-separator='=' --quiet <<'SQL' > "$DUMP.counts"
SELECT 'users', count(*) FROM users
UNION ALL SELECT 'dossiers', count(*) FROM dossiers
UNION ALL SELECT 'dossier_answers', count(*) FROM dossier_answers
UNION ALL SELECT 'documents', count(*) FROM documents
UNION ALL SELECT 'share_links', count(*) FROM share_links
UNION ALL SELECT 'questionnaire_fields', count(*) FROM questionnaire_fields
UNION ALL SELECT 'applied_migrations', count(*) FROM _prisma_migrations WHERE finished_at IS NOT NULL;
SQL
log "database dump ok: $(basename "$DUMP") ($(wc -c < "$DUMP") bytes)"

# 2. Documents: mirror the bucket; files changed or deleted since the last run move to a dated archive.
if [ -n "${DOCUMENTS_REMOTE:-}" ]; then
  log "syncing documents from $DOCUMENTS_REMOTE"
  rclone sync "$DOCUMENTS_REMOTE" "$BACKUP_DIR/documents/current" \
    --backup-dir "$BACKUP_DIR/documents/archive/$STAMP" --checksum
  log "documents ok: $(find "$BACKUP_DIR/documents/current" -type f | wc -l) objects"
else
  log "DOCUMENTS_REMOTE not set: document backup skipped"
fi

# 3. Local retention.
find "$DB_DIR" -maxdepth 1 -type f -name 'confluent-*' -mtime +"$RETENTION" -print -delete
if [ -d "$BACKUP_DIR/documents/archive" ]; then
  find "$BACKUP_DIR/documents/archive" -mindepth 1 -maxdepth 1 -type d -mtime +"$RETENTION" -exec rm -rf {} +
fi

# 4. Off-server copy. `copy` never deletes remotely: a compromised server cannot wipe the history;
#    remote retention is a lifecycle rule on the destination bucket.
if [ -n "${BACKUP_OFFSITE_REMOTE:-}" ]; then
  log "copying to $BACKUP_OFFSITE_REMOTE"
  rclone copy "$BACKUP_DIR" "$BACKUP_OFFSITE_REMOTE" --exclude '.*.partial'
  log "off-server copy ok"
else
  log "BACKUP_OFFSITE_REMOTE not set: no off-server copy (required in production)"
fi

date -u +%Y-%m-%dT%H:%M:%SZ > "$BACKUP_DIR/last-success"
log "done"
