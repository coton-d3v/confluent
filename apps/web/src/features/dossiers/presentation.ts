import { FINANCING_TYPE_LABELS, financingTypesOf } from '@confluent/shared'

const EUROS = new Intl.NumberFormat('fr-FR', {
  style: 'currency',
  currency: 'EUR',
  maximumFractionDigits: 0,
})

// « 750 000 € » (whole euros, E05.07).
export function formatAmount(amountEur: number | null | undefined): string | null {
  return amountEur === null || amountEur === undefined ? null : EUROS.format(amountEur)
}

export function financingTypeLabels(types: ReadonlyArray<string>): string[] {
  return financingTypesOf(types).map((t) => FINANCING_TYPE_LABELS[t])
}

// The amount typed in a text field, in whole euros: spaces (also non-breaking) and a trailing « € »
// are allowed; anything else is not an amount.
export function parseAmount(raw: string): number | null | 'invalid' {
  const compact = raw.replace(/[\s\u00a0\u202f]/g, '').replace(/\u20ac$/, '')
  if (compact === '') return null
  if (!/^\d+$/.test(compact)) return 'invalid'
  return Number(compact)
}

export interface PresentationData {
  summary: string | null
  objective: string | null
  description: string | null
  amountEur: number | null
  financingTypes: ReadonlyArray<string>
}

// Whether there is anything of the presentation to show (a share recipient gets none while the
// request is a draft).
export function hasPresentation(d: PresentationData): boolean {
  return Boolean(
    d.summary || d.objective || d.description || d.amountEur !== null || d.financingTypes.length,
  )
}
