import {
  ANSWER_MAX_LENGTH,
  accessLevelSchema,
  describeConstraints,
  isAnswered,
  readConstraints,
  type FieldType,
} from '@confluent/shared'
import type { QuestionnaireField, QuestionnaireSection } from '@prisma/client'
import { readChoices } from '../questionnaires/questionnaire-structure'

// What a client must send for each type (E04.01): the same formats as the site and the API accept.
const VALUE_FORMAT: Record<FieldType, string> = {
  text: 'Texte sur une ligne.',
  textarea: 'Texte libre, plusieurs lignes possibles.',
  email: 'Adresse email.',
  number: 'Nombre : chiffres, avec virgule ou point décimal (ex. "1200" ou "3,5").',
  date: 'Date au format AAAA-MM-JJ.',
  select: 'Clé d’un des choix (son libellé exact est aussi accepté).',
  checkbox: '"true" pour oui, "false" pour non.',
  file: 'Document déposé dans le dossier, pas de valeur écrite.',
}

const TEXT_TYPES = new Set<FieldType>(['text', 'textarea', 'email'])

const READ_LEVEL_LABEL: Record<string, string> = {
  public: 'tout financeur destinataire d’un partage',
  partiel: 'les partages partiel et complet',
  complet: 'les partages complets uniquement',
}

// The definition of a field as asked (E04.01): type, expected format, constraints in words and as
// values, choices. `withReadLevel` adds who may read the answer through a share (for the owner of
// the dossier and administrators only).
export function describeField(field: QuestionnaireField, opts: { withReadLevel: boolean }) {
  const type = field.fieldType as FieldType
  const constraints = readConstraints(type, field.constraints)
  const limits = describeConstraints(field)
  const choices = readChoices(field.choices)
  return {
    fieldId: field.id,
    key: field.key,
    label: field.label,
    ...(field.helpText ? { help: field.helpText } : {}),
    type,
    required: field.required,
    valueFormat: VALUE_FORMAT[type],
    ...(limits ? { limits } : {}),
    ...(type === 'file'
      ? {}
      : {
          // Any written answer is bounded; text fields may set a tighter maximum.
          constraints: {
            ...(TEXT_TYPES.has(type) ? { maxLength: ANSWER_MAX_LENGTH } : {}),
            ...constraints,
          },
        }),
    ...(type === 'select' && choices.length > 0 ? { choices } : {}),
    ...(opts.withReadLevel ? readLevelOf(field) : {}),
  }
}

// An unexpected stored level counts as the most restrictive one, as everywhere else (closed by default).
function readLevelOf(field: QuestionnaireField) {
  const parsed = accessLevelSchema.safeParse(field.minAccessLevel)
  const readLevel = parsed.success ? parsed.data : 'complet'
  return { readLevel, readableBy: READ_LEVEL_LABEL[readLevel] }
}

// Sections in their order, each with its fields (already ordered); empty sections are left out.
export function groupBySection<F extends { sectionId: string }, R>(
  sections: QuestionnaireSection[],
  fields: F[],
  describe: (field: F) => R,
) {
  return sections
    .map((section) => ({
      title: section.title,
      key: section.key,
      fields: fields.filter((f) => f.sectionId === section.id).map(describe),
    }))
    .filter((section) => section.fields.length > 0)
}

// Whether a field is answered: a written answer, or a document for an attachment (E03.11).
export function isFieldAnswered(
  field: Pick<QuestionnaireField, 'id' | 'fieldType'>,
  answers: ReadonlyMap<string, string>,
  attached: ReadonlySet<string>,
): boolean {
  return field.fieldType === 'file' ? attached.has(field.id) : isAnswered(answers.get(field.id))
}

// Completion of the visible fields (E04.01): overall and per section, required and optional.
export function describeCompletion(
  sections: QuestionnaireSection[],
  fields: QuestionnaireField[],
  answers: ReadonlyMap<string, string>,
  attached: ReadonlySet<string>,
  submittedAt: Date | null,
) {
  const count = (list: QuestionnaireField[]) => {
    const required = list.filter((f) => f.required)
    return {
      requiredTotal: required.length,
      requiredAnswered: required.filter((f) => isFieldAnswered(f, answers, attached)).length,
      fieldsTotal: list.length,
      fieldsAnswered: list.filter((f) => isFieldAnswered(f, answers, attached)).length,
    }
  }
  const overall = count(fields)
  const state = submittedAt
    ? 'soumis'
    : overall.requiredAnswered === overall.requiredTotal
      ? 'pret_a_soumettre'
      : 'incomplet'
  return {
    state,
    submittedAt,
    ...overall,
    sections: sections
      .map((section) => ({
        title: section.title,
        ...count(fields.filter((f) => f.sectionId === section.id)),
      }))
      .filter((section) => section.fieldsTotal > 0),
  }
}
