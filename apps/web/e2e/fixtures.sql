-- ROADMAP E10.01: what the smoke tests (e2e/smoke.spec.ts) expect in a migrated, disposable database:
-- an administrator, an entrepreneur and a workspace whose public page is published (not indexable,
-- the default) with a candidature form. Idempotent: the tests can run again on the same database.
INSERT INTO users (id, email, role, email_verified_at, first_name, last_name, updated_at)
VALUES
  (gen_random_uuid()::text, 'admin@smoke.test', 'admin', now(), 'Alice', 'Smoke', now()),
  (gen_random_uuid()::text, 'porteur@smoke.test', 'entrepreneur', now(), 'Paul', 'Smoke', now())
ON CONFLICT (email) DO NOTHING;

INSERT INTO workspaces (
  id, slug, name, program_name, presentation, public_criteria, public_contact,
  public_page_published, updated_at
)
VALUES (
  gen_random_uuid()::text, 'smoke-ci', 'Structure Smoke CI', 'Programme Smoke CI',
  'Accompagnement des entreprises du territoire.', 'Entreprises de moins de cinq ans.',
  'Écrivez-nous depuis le formulaire de demande d’accès.', true, now()
)
ON CONFLICT (slug) DO NOTHING;

-- Its published candidature form: what makes the page offer the access request form (E09.05).
INSERT INTO questionnaires (id, slug, name, usage, workspace_id, updated_at)
SELECT gen_random_uuid()::text, 'smoke-ci-candidature', 'Candidature Smoke CI', 'candidature', id, now()
FROM workspaces WHERE slug = 'smoke-ci'
ON CONFLICT (slug) DO NOTHING;

INSERT INTO questionnaire_versions (id, questionnaire_id, version, status, published_at, updated_at)
SELECT gen_random_uuid()::text, id, 1, 'published', now(), now()
FROM questionnaires WHERE slug = 'smoke-ci-candidature'
ON CONFLICT (questionnaire_id, version) DO NOTHING;
