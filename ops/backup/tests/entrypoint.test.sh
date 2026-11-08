#!/bin/sh
# Regression test for entrypoint.sh (code review R32), without Docker: `crond` and the scripts are
# replaced by stubs on PATH, and the crontab/env files are redirected to a temporary directory.
#   sh ops/backup/tests/entrypoint.test.sh
set -u
HERE=$(cd "$(dirname "$0")/.." && pwd)
WORK=$(mktemp -d)
trap 'rm -rf "$WORK"' EXIT
mkdir -p "$WORK/bin"
for stub in crond restore-check.sh backup.sh; do
  printf '#!/bin/sh\necho "%s $*"\nexit ${STUB_EXIT:-0}\n' "$stub" > "$WORK/bin/$stub"
  chmod +x "$WORK/bin/$stub"
done
export PATH="$WORK/bin:$PATH" BACKUP_CRONTAB="$WORK/crontab" BACKUP_ENV_FILE="$WORK/backup.env"
failures=0
check() { # description, expected output fragment, expected status, command…
  desc=$1 expected=$2 status=$3; shift 3
  out=$("$@" 2>&1); code=$?
  case "$out" in *"$expected"*) ok=1 ;; *) ok=0 ;; esac
  if [ "$ok" = 1 ] && [ "$code" = "$status" ]; then echo "ok   - $desc"; else
    echo "FAIL - $desc (status $code, output: $out)"; failures=$((failures + 1)); fi
}

check "a one-off command runs instead of the scheduler" \
  "restore-check.sh /restore/x.dump" 0 \
  env -u DATABASE_URL sh "$HERE/entrypoint.sh" restore-check.sh /restore/x.dump
check "the one-off command's failure is the container's exit status" \
  "restore-check.sh" 3 env STUB_EXIT=3 sh "$HERE/entrypoint.sh" restore-check.sh /restore/x.dump
check "the scheduler mode needs DATABASE_URL" \
  "DATABASE_URL is required" 1 env -u DATABASE_URL sh "$HERE/entrypoint.sh" scheduler
check "the scheduler mode starts crond with the schedule" \
  "crond -f -l 8" 0 env DATABASE_URL=postgresql://x BACKUP_SCHEDULE="5 4 * * *" sh "$HERE/entrypoint.sh" scheduler
grep -q '^5 4 \* \* \* ' "$WORK/crontab" 2>/dev/null && echo "ok   - crontab written with the schedule" \
  || { echo "FAIL - crontab written with the schedule"; failures=$((failures + 1)); }
check "the image's default command is the scheduler" "scheduler" 0 \
  grep -E '^CMD \["scheduler"\]' "$HERE/Dockerfile"

[ "$failures" = 0 ] && echo "entrypoint: all checks passed" || { echo "entrypoint: $failures failure(s)"; exit 1; }
