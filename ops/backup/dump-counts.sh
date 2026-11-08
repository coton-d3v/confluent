#!/bin/sh
# Row counts of the main tables as contained IN a dump (code review R34): computed from the dump's
# data, they describe exactly its snapshot, whatever was written while or after it was taken.
#   dump-counts.sh confluent-<stamp>.dump  →  "users=12" lines, in a fixed order
set -eu
DUMP="${1:?usage: dump-counts.sh <dump>}"
# Extracted to a file first (code review R42): in `pg_restore | awk` the pipeline's status is awk's,
# so a failed extraction would still print counts. Hidden name beside the dump, removed on exit.
DATA=$(mktemp "$(dirname "$DUMP")/.counts-data.XXXXXX")
trap 'rm -f "$DATA"' EXIT
pg_restore --data-only --file="$DATA" "$DUMP"
awk '
  /^COPY / {
    table = $2; sub(/^public\./, "", table); gsub(/"/, "", table)
    copying = 1; finished = 0
    if (table == "_prisma_migrations") {
      columns = $0; sub(/^[^(]*\(/, "", columns); sub(/\).*/, "", columns)
      n = split(columns, names, /, /)
      for (i = 1; i <= n; i++) if (names[i] == "finished_at") finished = i
    }
    next
  }
  copying && $0 == "\\." { copying = 0; next }
  copying {
    if (table == "_prisma_migrations") { split($0, values, "\t"); if (values[finished] != "\\N") rows["applied_migrations"]++ }
    else rows[table]++
  }
  END {
    n = split("users dossiers dossier_answers documents share_links questionnaire_fields applied_migrations", order, " ")
    for (i = 1; i <= n; i++) printf "%s=%d\n", order[i], rows[order[i]]
  }' "$DATA"
