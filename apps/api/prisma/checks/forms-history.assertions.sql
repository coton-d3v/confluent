-- Expected result of the forms migrations on forms-history.fixture.sql (code review R28/R29).
DO $$
DECLARE
  got TEXT;
BEGIN
  SELECT string_agg(title || '=' || key, ',' ORDER BY key) INTO got
  FROM questionnaire_sections WHERE version_id = 'v-check';
  IF got IS DISTINCT FROM 'Equipe=equipe,Équipe=equipe_2' THEN
    RAISE EXCEPTION 'sections: %', got;
  END IF;

  SELECT string_agg(id || '=' || key, ',' ORDER BY id) INTO got
  FROM questionnaire_fields WHERE version_id = 'v-check';
  IF got IS DISTINCT FROM 'f-explicit=nom_2,f-lettre=lettre,f-nom-1=nom,f-nom-2=nom_3' THEN
    RAISE EXCEPTION 'field keys: %', got;
  END IF;

  SELECT string_agg((c->>'label') || '=' || (c->>'key'), ',') INTO got
  FROM questionnaire_fields f, jsonb_array_elements(f.choices) c WHERE f.id = 'f-lettre';
  IF got IS DISTINCT FROM 'A=a,À=a_2,A_2=a_2_2' THEN
    RAISE EXCEPTION 'choices: %', got;
  END IF;

  -- The answer « A_2 » keeps its meaning, and the answer to the second « Nom » keeps its field.
  SELECT string_agg(field_id || '=' || value, ',' ORDER BY field_id) INTO got
  FROM dossier_answers
  WHERE company_id = (SELECT company_id FROM dossiers WHERE id = 'd-check');
  IF got IS DISTINCT FROM 'f-lettre=a_2_2,f-nom-2=Sophie' THEN
    RAISE EXCEPTION 'answers: %', got;
  END IF;

  -- E04.04: the provenance of answers saved before it was recorded stays unknown, not guessed.
  IF EXISTS (
    SELECT 1 FROM dossier_answers
    WHERE origin IS NOT NULL OR confirmation IS NOT NULL OR channel IS NOT NULL
      OR author_id IS NOT NULL OR client_name IS NOT NULL OR source_document_id IS NOT NULL
  ) THEN
    RAISE EXCEPTION 'answers saved before E04.04 must have no provenance';
  END IF;

  -- E05.04: each dossier got its own company, owned by the dossier's owner, its name brought to the
  -- company's format.
  SELECT string_agg(d.id || '=' || c.name, ',' ORDER BY d.id) INTO got
  FROM dossiers d JOIN companies c ON c.id = d.company_id AND c.owner_id = d.user_id
  WHERE d.id IN ('d-check', 'd-blank');
  IF got IS DISTINCT FROM 'd-blank=Entreprise sans nom,d-check=Contrôle' THEN
    RAISE EXCEPTION 'companies: %', got;
  END IF;
  IF (SELECT c.name FROM dossiers d JOIN companies c ON c.id = d.company_id WHERE d.id = 'd-long')
     IS DISTINCT FROM repeat('é', 199) THEN
    RAISE EXCEPTION 'long company name not cut to the company format';
  END IF;
  IF (SELECT count(DISTINCT company_id) FROM dossiers) <> (SELECT count(*) FROM dossiers)
     OR (SELECT count(*) FROM companies) <> (SELECT count(*) FROM dossiers) THEN
    RAISE EXCEPTION 'one company per dossier expected';
  END IF;

  -- E05.05: answers and documents moved, same rows, to the company of their dossier, whose profile
  -- answers the dossier's form version.
  SELECT string_agg(x.id || '=' || d.id, ',' ORDER BY x.id) INTO got
  FROM (SELECT id, company_id FROM dossier_answers UNION ALL SELECT id, company_id FROM documents) x
  JOIN dossiers d ON d.company_id = x.company_id;
  IF got IS DISTINCT FROM 'a-lettre=d-check,a-nom-2=d-check,doc-blank=d-blank,doc-check-1=d-check,doc-check-2=d-check' THEN
    RAISE EXCEPTION 'profile owners: %', got;
  END IF;
  IF (SELECT string_agg(storage_key || '@' || version, ',' ORDER BY id) FROM documents)
     IS DISTINCT FROM 'dossiers/d-blank/k1@1,dossiers/d-check/k1@1,dossiers/d-check/k2@2' THEN
    RAISE EXCEPTION 'documents changed by the move';
  END IF;
  IF EXISTS (
    SELECT 1 FROM dossiers d JOIN companies c ON c.id = d.company_id
    WHERE c.profile_version_id IS DISTINCT FROM d.questionnaire_version_id
  ) THEN
    RAISE EXCEPTION 'profile version differs from the dossier''s';
  END IF;

  -- E05.06: each version filed under one library document per (company, field, name), of type
  -- `other`, numbers kept.
  SELECT string_agg(d.id || '@' || d.version || '=' || l.filename || ':' || l.type, ',' ORDER BY d.id) INTO got
  FROM documents d JOIN library_documents l ON l.id = d.library_document_id;
  IF got IS DISTINCT FROM 'doc-blank@1=kbis.pdf:other,doc-check-1@1=kbis.pdf:other,doc-check-2@2=kbis.pdf:other' THEN
    RAISE EXCEPTION 'library documents: %', got;
  END IF;
  IF (SELECT count(DISTINCT library_document_id) FROM documents) <> 2 THEN
    RAISE EXCEPTION 'one library document per company and name expected';
  END IF;

  -- E05.07: each dossier a draft without presentation, selecting its company's whole library,
  -- following the latest version.
  SELECT string_agg(s.dossier_id || '=' || l.filename || ':' || coalesce(s.pinned_version_id, 'latest'), ',' ORDER BY s.dossier_id)
  INTO got
  FROM dossier_documents s JOIN library_documents l ON l.id = s.library_document_id;
  IF got IS DISTINCT FROM 'd-blank=kbis.pdf:latest,d-check=kbis.pdf:latest' THEN
    RAISE EXCEPTION 'document selections: %', got;
  END IF;
  IF EXISTS (
    SELECT 1 FROM dossiers
    WHERE publication_status <> 'draft' OR published_at IS NOT NULL OR financing_types <> '{}'
      OR summary IS NOT NULL OR objective IS NOT NULL OR description IS NOT NULL OR amount_eur IS NOT NULL
  ) THEN
    RAISE EXCEPTION 'existing dossiers must stay drafts without presentation';
  END IF;
END
$$;
