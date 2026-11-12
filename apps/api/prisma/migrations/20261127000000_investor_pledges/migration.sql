-- ROADMAP E07.06: an investor's pledge (« promesse ») on a financing request — a declarative
-- intention, never a commitment (rules: @confluent/shared `pledge.schema.ts`).
--
--  * `investor_pledges`: at most one pledge per (request, investor) — unique —, separate from the
--    mark of interest (E07.05): an intention among a closed list, an amount in whole euros, an
--    optional plain-text comment, and the investor's two consents — show their name, show their
--    amount to the request's owner — with no default (the application always writes both). Its
--    `version` is a new revision at each write, drawn from `investor_pledge_revisions` — one
--    sequence for every pledge, so a revision is never reused, not even by a pledge made again
--    after a withdrawal: a change written from a revision read earlier is refused, never applied
--    over a newer pledge (code review R63). A withdrawal deletes the row. Who still counts (the investor reads the request as an
--    opportunity, E07.03) is read at each request, never stored here. Removed with the request or
--    with the account.
--  * `audit_action` gains `investor_pledge_set` (a pledge made or changed) and
--    `investor_pledge_withdrawn`; both hidden from the request's owner, whose view is the count, the
--    total and what each investor chose to show.
--
-- CHECK: the closed list of intentions, the amount's bounds (those of a request's amount and of a
-- plan line), the comment's text rule (the internal notes' one, at most 1 000 characters) and a
-- positive version — kept equal to `pledge.schema.ts`.
--
-- Backfill: none — no pledge was ever made, the table starts empty and nothing else is touched.
--
-- Deployment resume: Prisma runs this file as one transaction; each statement can also run again on
-- a partly migrated database (IF [NOT] EXISTS, constraints dropped before being added), so any prefix
-- of this file, then the whole file, gives the same database (test/pg/pledges.pg-spec.ts). Undone by
-- prisma/checks/20261127000000_investor_pledges.down.sql.

ALTER TYPE "audit_action" ADD VALUE IF NOT EXISTS 'investor_pledge_set';

ALTER TYPE "audit_action" ADD VALUE IF NOT EXISTS 'investor_pledge_withdrawn';

CREATE SEQUENCE IF NOT EXISTS "investor_pledge_revisions" AS INTEGER;

CREATE TABLE IF NOT EXISTS "investor_pledges" (
    "id" TEXT NOT NULL,
    "dossier_id" TEXT NOT NULL,
    "investor_id" TEXT NOT NULL,
    "intention" TEXT NOT NULL,
    "amount_eur" INTEGER NOT NULL,
    "comment" TEXT,
    "show_name" BOOLEAN NOT NULL,
    "show_amount" BOOLEAN NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "investor_pledges_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "investor_pledges_dossier_id_investor_id_key" ON "investor_pledges"("dossier_id", "investor_id");

CREATE INDEX IF NOT EXISTS "investor_pledges_investor_id_idx" ON "investor_pledges"("investor_id");

ALTER TABLE "investor_pledges" DROP CONSTRAINT IF EXISTS "investor_pledges_dossier_id_fkey";

ALTER TABLE "investor_pledges" ADD CONSTRAINT "investor_pledges_dossier_id_fkey" FOREIGN KEY ("dossier_id") REFERENCES "dossiers"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "investor_pledges" DROP CONSTRAINT IF EXISTS "investor_pledges_investor_id_fkey";

ALTER TABLE "investor_pledges" ADD CONSTRAINT "investor_pledges_investor_id_fkey" FOREIGN KEY ("investor_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- An intention among the closed list; whole euros from 1 to 1 billion; a comment that is trimmed
-- plain text in paragraphs (line breaks only, at most one blank line in a row), 1 to 1 000
-- characters, without anything that looks like an HTML tag — or none.
ALTER TABLE "investor_pledges" DROP CONSTRAINT IF EXISTS "investor_pledges_check";

ALTER TABLE "investor_pledges" ADD CONSTRAINT "investor_pledges_check" CHECK (
  "intention" IN ('exploring', 'likely', 'strong')
  AND "amount_eur" BETWEEN 1 AND 1000000000
  AND ("comment" IS NULL OR (
    char_length("comment") BETWEEN 1 AND 1000
    AND "comment" = btrim("comment", E' \n')
    AND translate("comment", E'\n', '') !~ '[[:cntrl:]]'
    AND strpos("comment", E'\n\n\n') = 0
    AND "comment" !~ '<[A-Za-z!/?]'
  ))
  AND "version" >= 1
);
