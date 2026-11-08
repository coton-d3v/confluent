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
  FROM dossier_answers WHERE dossier_id = 'd-check';
  IF got IS DISTINCT FROM 'f-lettre=a_2_2,f-nom-2=Sophie' THEN
    RAISE EXCEPTION 'answers: %', got;
  END IF;
END
$$;
