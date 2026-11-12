-- ROADMAP E08.02: beside a committee's internal notes (`internal_notes`, E08.01, untouched), the
-- information its managers share with its candidates and investors (`shared_info`). Rules and
-- limits: @confluent/shared `committee.schema.ts` (`toSharedCommittee` is the only view of a
-- committee for a reader outside the workspace's conseillers; it never holds `internal_notes`).
--
--  * `committees.shared_info`: plain text in paragraphs, or none.
--  * No new journal action: a change is journaled by `committee_updated`, which names the field and
--    never copies the text.
--
-- CHECK (`committees_shared_info_check`, beside `committees_check`): trimmed paragraphs without
-- markup, 1 to 3000 characters.
--
-- Backfill: none — the column starts empty for every committee (none shared anything before).
--
-- Deployment resume: Prisma runs this file as one transaction; each statement can also run again on a
-- partly migrated database (IF NOT EXISTS, constraint dropped before being added), so any prefix of
-- this file, then the whole file, gives the same database (test/pg/committee-shared-info.pg-spec.ts).
-- Undone by prisma/checks/20261202000000_committee_shared_info.down.sql.

ALTER TABLE "committees" ADD COLUMN IF NOT EXISTS "shared_info" TEXT;

ALTER TABLE "committees" DROP CONSTRAINT IF EXISTS "committees_shared_info_check";

ALTER TABLE "committees" ADD CONSTRAINT "committees_shared_info_check" CHECK (
  "shared_info" IS NULL OR (
    char_length("shared_info") BETWEEN 1 AND 3000
    AND "shared_info" = btrim("shared_info", E' \n')
    AND translate("shared_info", E'\n', '') !~ '[[:cntrl:]]'
    AND strpos("shared_info", E'\n\n\n') = 0
    AND "shared_info" !~ '<[A-Za-z!/?]'
  )
);
