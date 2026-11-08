# Backup worker for Confluent (ROADMAP E02.10/E02.11): pg_dump/pg_restore of the same major version
# as the database, rclone for documents and the off-server copy, busybox crond for the schedule.
FROM postgres:16-alpine
RUN apk add --no-cache rclone tzdata
COPY backup.sh restore-check.sh entrypoint.sh /usr/local/bin/
RUN chmod 0755 /usr/local/bin/backup.sh /usr/local/bin/restore-check.sh /usr/local/bin/entrypoint.sh
VOLUME ["/backups"]
ENTRYPOINT ["/usr/local/bin/entrypoint.sh"]
