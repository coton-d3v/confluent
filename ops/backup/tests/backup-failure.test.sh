#!/bin/sh
# Regression test for R42: a failed extraction of the dump's data must fail the counts and the whole
# backup — no counts file, no published dump, no last-success. No database needed: pg_dump and
# pg_restore are stubs on PATH (a real pg_restore, when installed, also reads a corrupt dump).
#   sh ops/backup/tests/backup-failure.test.sh
set -u
HERE=$(cd "$(dirname "$0")/.." && pwd)
REAL_PG_RESTORE=$(command -v pg_restore || true)
WORK=$(mktemp -d)
trap 'rm -rf "$WORK"' EXIT
mkdir -p "$WORK/bin"
# pg_dump writes a file; pg_restore lists it fine but its data extraction prints a partial COPY
# section, then fails with status 7 (as a truncated or unreadable dump would).
cat > "$WORK/bin/pg_dump" <<'STUB'
#!/bin/sh
for a in "$@"; do case "$a" in --file=*) echo dump > "${a#--file=}" ;; esac; done
STUB
cat > "$WORK/bin/pg_restore" <<'STUB'
#!/bin/sh
case " $* " in *" --list "*) exit 0 ;; esac
for a in "$@"; do case "$a" in --file=*) out="${a#--file=}" ;; esac; done
[ "${out:--}" = - ] && out=/dev/stdout
printf 'COPY public.users (id) FROM stdin;\nu-1\n' > "$out"
exit 7
STUB
chmod +x "$WORK/bin/pg_dump" "$WORK/bin/pg_restore"
failures=0
fail() { echo "FAIL - $*"; failures=$((failures + 1)); }

# 1. dump-counts.sh propagates the extraction failure and prints no counts.
out=$(PATH="$WORK/bin:$PATH" sh "$HERE/dump-counts.sh" "$WORK/any.dump" 2>/dev/null); code=$?
if [ "$code" != 0 ] && [ -z "$out" ]; then echo "ok   - dump-counts fails when pg_restore fails"; else
  fail "dump-counts fails when pg_restore fails (status $code, output: $out)"; fi

# 2. backup.sh stops: no published dump, no counts, no last-success.
mkdir -p "$WORK/backups"
PATH="$WORK/bin:$PATH" DATABASE_URL=postgresql://stub BACKUP_DIR="$WORK/backups" \
  sh "$HERE/backup.sh" >"$WORK/backup.log" 2>&1; code=$?
published=$(find "$WORK/backups" -name 'confluent-*' | wc -l)
if [ "$code" != 0 ] && [ "$published" = 0 ] && [ ! -e "$WORK/backups/last-success" ] \
  && [ -z "$(find "$WORK/backups" -name '.*.partial')" ]; then
  echo "ok   - backup fails without publishing a dump, counts or last-success"
else
  fail "backup with failed counts (status $code, published $published:"
  find "$WORK/backups" -type f; cat "$WORK/backup.log"
fi

# 3. With the real pg_restore: a corrupt dump is refused too.
if [ -n "$REAL_PG_RESTORE" ]; then
  printf 'PGDMP pas un vrai dump' > "$WORK/corrupt.dump"
  mkdir -p "$WORK/real" && ln -s "$REAL_PG_RESTORE" "$WORK/real/pg_restore"
  out=$(PATH="$WORK/real:$PATH" sh "$HERE/dump-counts.sh" "$WORK/corrupt.dump" 2>/dev/null); code=$?
  if [ "$code" != 0 ] && [ -z "$out" ]; then echo "ok   - a corrupt dump is refused"; else
    fail "a corrupt dump is refused (status $code, output: $out)"; fi
else
  echo "skip - pg_restore not installed: corrupt-dump case not run"
fi

[ "$failures" = 0 ] && echo "backup-failure: all checks passed" || { echo "backup-failure: $failures failure(s)"; exit 1; }
