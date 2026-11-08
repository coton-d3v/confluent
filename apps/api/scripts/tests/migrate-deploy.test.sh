#!/bin/sh
# Regression test for R35, without Doppler nor database: `prisma` is a stub that prints the URL it
# would use; DATABASE_URL plays the value Doppler injects (application account).
#   sh apps/api/scripts/tests/migrate-deploy.test.sh
set -u
HERE=$(cd "$(dirname "$0")/.." && pwd)
WORK=$(mktemp -d)
trap 'rm -rf "$WORK"' EXIT
printf '#!/bin/sh\necho "prisma $* with $DATABASE_URL"\n' > "$WORK/prisma"
chmod +x "$WORK/prisma"
export PATH="$WORK:$PATH"
failures=0
expect() { # description, expected fragment, output
  case "$3" in *"$2"*) echo "ok   - $1" ;; *) echo "FAIL - $1 (output: $3)"; failures=$((failures + 1)) ;; esac
}
out=$(cd "$HERE/.." && env DATABASE_URL=postgresql://app@db/x MIGRATION_DATABASE_URL=postgresql://migrator@db/x \
  sh scripts/migrate-deploy.sh 2>&1)
expect "the migration account wins over an injected DATABASE_URL" "with postgresql://migrator@db/x" "$out"
expect "the command is prisma migrate deploy" "prisma migrate deploy --schema=./prisma/schema.prisma" "$out"
out=$(cd "$HERE/.." && env -u MIGRATION_DATABASE_URL DATABASE_URL=postgresql://app@db/x sh scripts/migrate-deploy.sh 2>&1)
expect "without a migration account, DATABASE_URL is used and said so" "MIGRATION_DATABASE_URL is not set" "$out"
grep -q '"db:migrate:deploy": "sh ./scripts/migrate-deploy.sh"' "$HERE/../package.json" \
  && echo "ok   - db:migrate:deploy goes through migrate-deploy.sh" \
  || { echo "FAIL - db:migrate:deploy goes through migrate-deploy.sh"; failures=$((failures + 1)); }
[ "$failures" = 0 ] && echo "migrate-deploy: all checks passed" || { echo "migrate-deploy: $failures failure(s)"; exit 1; }
