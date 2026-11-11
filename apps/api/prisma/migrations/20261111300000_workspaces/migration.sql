-- ROADMAP E05.01: workspaces (one per structure) and their settings. A new table, nothing attached
-- to it yet: no existing row changes. The CHECK constraints repeat the formats validated by the API
-- (@confluent/shared workspace.schema.ts), so that no other writer can store a value the site and
-- the future public page (/w/<slug>) would have to defend against.

CREATE TABLE "workspaces" (
    "id" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "program_name" TEXT,
    "color" TEXT,
    "presentation" TEXT,
    "contact_email" TEXT,
    "email_domain" TEXT,
    "logo_key" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "workspaces_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "workspaces_slug_check"
      CHECK ("slug" ~ '^[a-z0-9]+(-[a-z0-9]+)*$' AND char_length("slug") BETWEEN 2 AND 60),
    CONSTRAINT "workspaces_name_check"
      CHECK (char_length(btrim("name")) BETWEEN 1 AND 120),
    CONSTRAINT "workspaces_program_name_check"
      CHECK (char_length(btrim("program_name")) BETWEEN 1 AND 120),
    CONSTRAINT "workspaces_color_check"
      CHECK ("color" ~ '^#[0-9a-f]{6}$'),
    CONSTRAINT "workspaces_presentation_check"
      CHECK (char_length(btrim("presentation")) BETWEEN 1 AND 5000),
    CONSTRAINT "workspaces_contact_email_check"
      CHECK ("contact_email" = lower("contact_email") AND "contact_email" LIKE '_%@_%' AND char_length("contact_email") <= 254),
    CONSTRAINT "workspaces_email_domain_check"
      CHECK ("email_domain" ~ '^([a-z0-9]([a-z0-9-]*[a-z0-9])?\.)+[a-z0-9-]*[a-z0-9]$' AND char_length("email_domain") <= 253),
    CONSTRAINT "workspaces_logo_key_check"
      CHECK ("logo_key" LIKE 'workspaces/' || "id" || '/logo/%')
);

CREATE UNIQUE INDEX "workspaces_slug_key" ON "workspaces"("slug");

ALTER TYPE "audit_action" ADD VALUE 'workspace_created';
ALTER TYPE "audit_action" ADD VALUE 'workspace_updated';
