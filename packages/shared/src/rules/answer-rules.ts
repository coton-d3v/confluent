import { readConstraints } from '../schemas/field-constraints.schema.js'
import type { Choice, FieldType } from '../schemas/questionnaire.schema.js'

// Answer rules shared by the API (authoritative) and the site (immediate feedback), so that both
// accept exactly the same values (ROADMAP E03.04, E03.05). Messages are shown to users as is.

export interface AnswerField {
  fieldType: FieldType
  choices: readonly Choice[]
  constraints: unknown
}

export const ANSWER_MAX_LENGTH = 10_000

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
const NUMBER = /^-?\d+([.,]\d+)?$/
const DATE = /^\d{4}-\d{2}-\d{2}$/

// "3,5" and "3.5" are the same number.
export function parseNumber(value: string): number | null {
  const trimmed = value.trim()
  return NUMBER.test(trimmed) ? Number(trimmed.replace(',', '.')) : null
}

// French typography, identical in every runtime (no dependency on the ICU data available):
// 1 500 000,5 with narrow no-break spaces.
export function formatNumber(n: number): string {
  const [int, dec] = String(Math.abs(n)).split('.')
  const grouped = int.replace(/\B(?=(\d{3})+(?!\d))/g, '\u202f')
  return `${n < 0 ? '-' : ''}${grouped}${dec ? `,${dec}` : ''}`
}
const formatDate = (iso: string) => iso.split('-').reverse().join('/')

// Why `value` does not fit `field`, or null when it does. An empty string clears an answer and is
// always accepted here: whether an answer is required is checked when the dossier is submitted.
export function validateAnswerValue(field: AnswerField, value: string): string | null {
  if (value.length > ANSWER_MAX_LENGTH) return `${ANSWER_MAX_LENGTH} caractères maximum.`
  if (value === '') return null
  const constraints = readConstraints(field.fieldType, field.constraints)
  switch (field.fieldType) {
    case 'text':
    case 'textarea': {
      const length = value.trim().length
      if (constraints.minLength !== undefined && length < constraints.minLength) {
        return `${constraints.minLength} caractères minimum.`
      }
      if (constraints.maxLength !== undefined && length > constraints.maxLength) {
        return `${constraints.maxLength} caractères maximum.`
      }
      return null
    }
    case 'email':
      return EMAIL.test(value.trim()) ? null : 'Adresse email invalide.'
    case 'number': {
      const n = parseNumber(value)
      if (n === null) return 'Nombre attendu (ex. 1200 ou 3,5).'
      if (constraints.integer && !Number.isInteger(n)) return 'Nombre entier attendu.'
      if (typeof constraints.min === 'number' && n < constraints.min) {
        return `Valeur minimale : ${formatNumber(constraints.min)}.`
      }
      if (typeof constraints.max === 'number' && n > constraints.max) {
        return `Valeur maximale : ${formatNumber(constraints.max)}.`
      }
      return null
    }
    case 'date': {
      if (!DATE.test(value) || Number.isNaN(Date.parse(value))) {
        return 'Date attendue au format AAAA-MM-JJ.'
      }
      if (typeof constraints.min === 'string' && value < constraints.min) {
        return `Date au plus tôt : ${formatDate(constraints.min)}.`
      }
      if (typeof constraints.max === 'string' && value > constraints.max) {
        return `Date au plus tard : ${formatDate(constraints.max)}.`
      }
      return null
    }
    case 'checkbox':
      return value === 'true' || value === 'false' ? null : 'Valeur attendue : "true" ou "false".'
    case 'select':
      return field.choices.length === 0 || field.choices.some((c) => c.key === value)
        ? null
        : `Choix attendu parmi : ${field.choices.map((c) => `"${c.key}" (${c.label})`).join(', ')}.`
    case 'file':
      return 'Ce champ attend un document : utilisez le dépôt de documents.'
  }
}

// Human summary of a field's limits, for hints (e.g. « 500 caractères maximum »); null when none.
export function describeConstraints(
  field: Pick<AnswerField, 'fieldType' | 'constraints'>,
): string | null {
  const c = readConstraints(field.fieldType, field.constraints)
  const parts: string[] = []
  if (c.minLength !== undefined) parts.push(`${c.minLength} caractères minimum`)
  if (c.maxLength !== undefined) parts.push(`${c.maxLength} caractères maximum`)
  if (c.integer) parts.push('nombre entier')
  if (typeof c.min === 'number') parts.push(`minimum ${formatNumber(c.min)}`)
  if (typeof c.max === 'number') parts.push(`maximum ${formatNumber(c.max)}`)
  if (typeof c.min === 'string') parts.push(`à partir du ${formatDate(c.min)}`)
  if (typeof c.max === 'string') parts.push(`jusqu’au ${formatDate(c.max)}`)
  if (parts.length === 0) return null
  const text = parts.join(', ')
  return text.charAt(0).toUpperCase() + text.slice(1) + '.'
}

export const isAnswered = (value: string | undefined): boolean => (value ?? '').trim() !== ''

// Required questions still without an answer, in the given order (E03.10). Attachments are left out
// until documents are part of the filling journey (E03.11).
export function missingRequiredAnswers<
  F extends { id: string; required: boolean; fieldType: FieldType },
>(fields: readonly F[], answers: Readonly<Record<string, string>>): F[] {
  return fields.filter((f) => f.required && f.fieldType !== 'file' && !isAnswered(answers[f.id]))
}
