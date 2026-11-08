#!/bin/sh
# Schedules backup.sh with busybox crond (BACKUP_SCHEDULE, default 03:00 UTC daily).
# crond does not pass the container environment to jobs: it is saved to a root-only file instead.
set -eu
: "${DATABASE_URL:?DATABASE_URL is required}"
SCHEDULE="${BACKUP_SCHEDULE:-0 3 * * *}"
umask 077
export -p > /etc/backup.env
echo "$SCHEDULE . /etc/backup.env && /usr/local/bin/backup.sh >> /proc/1/fd/1 2>&1" > /etc/crontabs/root
if [ "${BACKUP_ON_START:-false}" = "true" ]; then
  /usr/local/bin/backup.sh
fi
echo "backup worker: schedule '$SCHEDULE' (UTC)"
exec crond -f -l 8
