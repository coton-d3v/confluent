-- Historical data placed just before migration 20261109010000 (forms) by
-- scripts/check-migration-chain.sh: labels and keys that collide once turned into keys
-- (code review R28/R29). Schema as of migration 20261109000000.
INSERT INTO users (id, email, role, updated_at) VALUES ('u-check', 'check@localhost.dev', 'entrepreneur', now());
INSERT INTO questionnaire_versions (id, version, is_published, created_at) VALUES ('v-check', 1, true, now());
INSERT INTO questionnaire_fields (id, version_id, section, label, field_type, required, order_index, options, key, min_access_level) VALUES
  ('f-nom-1', 'v-check', 'Équipe', 'Nom', 'text', true, 0, '{}', NULL, 'complet'),
  ('f-nom-2', 'v-check', 'Equipe', 'Nom', 'text', true, 1, '{}', NULL, 'complet'),
  ('f-explicit', 'v-check', 'Équipe', 'Autre', 'text', true, 2, '{}', 'nom_2', 'complet'),
  ('f-lettre', 'v-check', 'Équipe', 'Lettre', 'select', true, 3, '{"A","À","A_2"}', 'lettre', 'complet');
INSERT INTO dossiers (id, user_id, name, slug, questionnaire_version_id, updated_at)
  VALUES ('d-check', 'u-check', 'Contrôle', 'controle', 'v-check', now());
INSERT INTO dossier_answers (id, dossier_id, field_id, value, updated_at) VALUES
  ('a-lettre', 'd-check', 'f-lettre', 'A_2', now()),
  ('a-nom-2', 'd-check', 'f-nom-2', 'Sophie', now());
