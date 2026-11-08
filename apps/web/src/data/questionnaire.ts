import type { Choice, FieldType } from '@confluent/shared'

export interface Question {
  readonly id: string
  readonly label: string
  readonly hint?: string
  readonly fieldType: FieldType
  // An optional question can be left empty (E03.05).
  readonly required: boolean
  // Input limits set in the form builder, checked with the shared answer rules.
  readonly constraints: unknown
  // List fields only: the answer stores a choice key, the label is displayed.
  readonly choices?: readonly Choice[]
}

export interface Section {
  readonly id: string
  readonly title: string
  readonly questions: readonly Question[]
}

export interface QuestionMeta extends Question {
  readonly sectionId: string
  readonly sectionTitle: string
  readonly sectionIndex: number
  readonly positionInSection: number
  readonly globalIndex: number
}
