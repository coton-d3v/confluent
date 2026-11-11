-- ROADMAP E05.08: a conseiller prepares a company for an entrepreneur, invites them, and the
-- entrepreneur accepts or declines its ownership.
--
--  * `companies.prepared_in_workspace_id`: set while a conseiller of that workspace holds the company
--    for an entrepreneur (the conseiller is then its owner, `owner_id`); cleared when the
--    entrepreneur accepts, in the same statement that makes them the owner — the dossiers follow
--    through their (company_id, user_id) foreign key, ON UPDATE CASCADE (E05.04).
--  * `company_transfers`: each invitation to take a company over, then its outcome — who offered it,
--    to which address and account, from which workspace, when it was decided. At most one pending
--    invitation per company (partial unique index).
--
-- Backfill: none needed. Every existing company is its entrepreneur's own (`prepared_in_workspace_id`
-- NULL) and has never been transferred (no row in `company_transfers`).
--
-- Deployment resume: Prisma runs this file as one transaction; each statement can also run again on
-- a partly migrated database (IF [NOT] EXISTS, constraints dropped before being added), so any
-- prefix of this file, then the whole file, gives the same database
-- (test/pg/company-transfers.pg-spec.ts). Undone by
-- prisma/checks/20261114000000_company_transfers.down.sql.

ALTER TYPE "audit_action" ADD VALUE IF NOT EXISTS 'company_prepared';

ALTER TYPE "audit_action" ADD VALUE IF NOT EXISTS 'company_transfer_invited';

ALTER TYPE "audit_action" ADD VALUE IF NOT EXISTS 'company_transfer_accepted';

ALTER TYPE "audit_action" ADD VALUE IF NOT EXISTS 'company_transfer_declined';

ALTER TYPE "audit_action" ADD VALUE IF NOT EXISTS 'company_transfer_cancelled';

-- 1. The workspace a company is prepared in, while a conseiller holds it.
ALTER TABLE "companies" ADD COLUMN IF NOT EXISTS "prepared_in_workspace_id" TEXT;

CREATE INDEX IF NOT EXISTS "companies_prepared_in_workspace_id_idx" ON "companies"("prepared_in_workspace_id");

ALTER TABLE "companies" DROP CONSTRAINT IF EXISTS "companies_prepared_in_workspace_id_fkey";

ALTER TABLE "companies" ADD CONSTRAINT "companies_prepared_in_workspace_id_fkey" FOREIGN KEY ("prepared_in_workspace_id") REFERENCES "workspaces"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- 2. Invitations to take a company over, and their outcome.
CREATE TABLE IF NOT EXISTS "company_transfers" (
    "id" TEXT NOT NULL,
    "company_id" TEXT NOT NULL,
    "workspace_id" TEXT NOT NULL,
    "from_user_id" TEXT,
    "to_user_id" TEXT NOT NULL,
    "to_email" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "expires_at" TIMESTAMP(3) NOT NULL,
    "decided_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "company_transfers_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "company_transfers_company_id_idx" ON "company_transfers"("company_id");

CREATE INDEX IF NOT EXISTS "company_transfers_workspace_id_idx" ON "company_transfers"("workspace_id");

CREATE INDEX IF NOT EXISTS "company_transfers_from_user_id_idx" ON "company_transfers"("from_user_id");

CREATE INDEX IF NOT EXISTS "company_transfers_to_user_id_idx" ON "company_transfers"("to_user_id");

-- At most one invitation waiting for an answer per company: a new one replaces it (the application
-- closes the previous one first, under the company's lock).
CREATE UNIQUE INDEX IF NOT EXISTS "company_transfers_one_pending_per_company"
  ON "company_transfers"("company_id") WHERE "status" = 'pending';

ALTER TABLE "company_transfers" DROP CONSTRAINT IF EXISTS "company_transfers_company_id_fkey";

ALTER TABLE "company_transfers" ADD CONSTRAINT "company_transfers_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "company_transfers" DROP CONSTRAINT IF EXISTS "company_transfers_workspace_id_fkey";

ALTER TABLE "company_transfers" ADD CONSTRAINT "company_transfers_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "company_transfers" DROP CONSTRAINT IF EXISTS "company_transfers_from_user_id_fkey";

ALTER TABLE "company_transfers" ADD CONSTRAINT "company_transfers_from_user_id_fkey" FOREIGN KEY ("from_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "company_transfers" DROP CONSTRAINT IF EXISTS "company_transfers_to_user_id_fkey";

ALTER TABLE "company_transfers" ADD CONSTRAINT "company_transfers_to_user_id_fkey" FOREIGN KEY ("to_user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Closed values, repeated from @confluent/shared (COMPANY_TRANSFER_STATUSES); `decided_at` is set
-- exactly once the invitation is no longer pending.
ALTER TABLE "company_transfers" DROP CONSTRAINT IF EXISTS "company_transfers_status_check";

ALTER TABLE "company_transfers" ADD CONSTRAINT "company_transfers_status_check" CHECK (
  "status" IN ('pending', 'accepted', 'declined', 'cancelled', 'expired')
  AND ("status" = 'pending') = ("decided_at" IS NULL)
);

-- The address as the application stores it: trimmed, lower-case, one « @ », at most 254 characters.
ALTER TABLE "company_transfers" DROP CONSTRAINT IF EXISTS "company_transfers_to_email_check";

ALTER TABLE "company_transfers" ADD CONSTRAINT "company_transfers_to_email_check" CHECK (
  "to_email" = lower(btrim("to_email"))
  AND char_length("to_email") BETWEEN 3 AND 254
  AND "to_email" ~ '^[^@[:space:]]+@[^@[:space:]]+$'
);

-- Nobody transfers a company to themselves; an invitation has a validity.
ALTER TABLE "company_transfers" DROP CONSTRAINT IF EXISTS "company_transfers_parties_check";

ALTER TABLE "company_transfers" ADD CONSTRAINT "company_transfers_parties_check" CHECK (
  "from_user_id" IS NULL OR "from_user_id" <> "to_user_id"
);

ALTER TABLE "company_transfers" DROP CONSTRAINT IF EXISTS "company_transfers_expires_at_check";

ALTER TABLE "company_transfers" ADD CONSTRAINT "company_transfers_expires_at_check" CHECK (
  "expires_at" > "created_at"
);
