#!/bin/sh
# Backup worker entrypoint (ROADMAP E02.10/E02.11). Two modes:
#   scheduler (default)  runs backup.sh on BACKUP_SCHEDULE with busybox crond (needs DATABASE_URL);
#   any other command    runs it once and exits with its status, e.g.
#                        `docker compose run --rm backup restore-check.sh /restore/x.dump`.
set -eu

if [ "$#" -gt 0 ] && [ "$1" != "scheduler" ]; then
  exec "$@"
fi

if [ -z "${DATABASE_URL:-}" ]; then
  echo "backup worker: DATABASE_URL is required in scheduler mode" >&2
  exit 1
fi
SCHEDULE="${BACKUP_SCHEDULE:-0 3 * * *}"
CRONTAB="${BACKUP_CRONTAB:-/etc/crontabs/root}"
ENV_FILE="${BACKUP_ENV_FILE:-/etc/backup.env}"
# crond does not pass the container environment to jobs: it is saved to a root-only file instead.
umask 077
export -p > "$ENV_FILE"
echo "$SCHEDULE . $ENV_FILE && /usr/local/bin/backup.sh >> /proc/1/fd/1 2>&1" > "$CRONTAB"
if [ "${BACKUP_ON_START:-false}" = "true" ]; then
  backup.sh
fi
echo "backup worker: schedule '$SCHEDULE' (UTC)"
exec crond -f -l 8
