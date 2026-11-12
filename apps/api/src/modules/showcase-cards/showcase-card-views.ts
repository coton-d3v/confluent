import type {
  Candidature,
  Committee,
  CommitteeApplication,
  Company,
  Dossier,
  FundingPlanLine,
  ShowcaseCard,
} from '@prisma/client'
import {
  fundingPlanTotals,
  showcaseRegionOf,
  toPublicCommittee,
  type PublicCard,
} from '@confluent/shared'
import { toView } from '../committees/committee-views'

// What the public reads of every column a card is built from (ROADMAP E09.02): `public` is copied to
// the card as is, `aggregate` only summed with others of its kind, `internal` never leaves the
// signed-in screens (some decide whether the card is shown, none is told). A column added to one of
// these tables without being classified here fails to compile, and the tests check these lists
// against the Prisma models and the database (closed by default: a new column is internal until it
// is named, and the projection copies named fields only). The committee a card names is read through
// `toPublicCommittee` (E09.01: name and when), never as a row.
type Audience = 'public' | 'aggregate' | 'internal'

export const SHOWCASE_CARD_COLUMN_AUDIENCE = {
  id: 'internal',
  candidatureId: 'internal',
  workspaceId: 'internal',
  pseudonym: 'public',
  region: 'public',
  consentedAt: 'internal',
  consentedById: 'internal',
  withdrawnAt: 'internal',
  withdrawnById: 'internal',
  withdrawalReason: 'internal',
  version: 'internal',
  createdAt: 'internal',
  updatedAt: 'internal',
} as const satisfies Record<keyof ShowcaseCard, Audience>

export const DOSSIER_COLUMN_AUDIENCE = {
  id: 'internal',
  userId: 'internal',
  companyId: 'internal',
  // The request's real title: never on a card (D06: a pseudonym, no real name in its place).
  name: 'internal',
  slug: 'internal',
  questionnaireVersionId: 'internal',
  // As the narrowest share level reads it (`projectDossierForLevel` at `public`, R31): null unless
  // every field it was computed from is readable at that level.
  sector: 'public',
  maturityStage: 'internal',
  ancrageCvl: 'internal',
  tagTechnologique: 'internal',
  axe1Projet: 'internal',
  axe2Financier: 'internal',
  axe3Origine: 'internal',
  deeptechScore: 'internal',
  preCreation: 'internal',
  classificationSources: 'internal',
  submittedAt: 'internal',
  summary: 'internal',
  objective: 'internal',
  description: 'internal',
  // The amount sought, also the plan's objective.
  amountEur: 'public',
  financingTypes: 'internal',
  publicationStatus: 'internal',
  publishedAt: 'internal',
  archivedAt: 'internal',
  createdAt: 'internal',
  updatedAt: 'internal',
} as const satisfies Record<keyof Dossier, Audience>

export const FUNDING_PLAN_LINE_COLUMN_AUDIENCE = {
  id: 'internal',
  candidatureId: 'internal',
  workspaceId: 'internal',
  // The source: never named, not even its category.
  categoryId: 'internal',
  label: 'internal',
  // Summed by state (obtained, in progress), never one by one.
  amountEur: 'aggregate',
  state: 'aggregate',
  version: 'internal',
  updatedBySide: 'internal',
  updatedById: 'internal',
  createdAt: 'internal',
  updatedAt: 'internal',
} as const satisfies Record<keyof FundingPlanLine, Audience>

export const CANDIDATURE_COLUMN_AUDIENCE = {
  id: 'internal',
  dossierId: 'internal',
  workspaceId: 'internal',
  formVersionId: 'internal',
  submittedAt: 'internal',
  // Decides whether the card is shown (open), never told: « en comité » is not diffused (E07.02).
  financingStatus: 'internal',
  financingStatusChangedAt: 'internal',
  createdAt: 'internal',
  updatedAt: 'internal',
} as const satisfies Record<keyof Candidature, Audience>

export const COMMITTEE_APPLICATION_COLUMN_AUDIENCE = {
  id: 'internal',
  committeeId: 'internal',
  candidatureId: 'internal',
  workspaceId: 'internal',
  // Only `accepted` on a planned session names it; every other status reads « en attente ».
  status: 'internal',
  statusBy: 'internal',
  statusActorId: 'internal',
  statusChangedAt: 'internal',
  version: 'internal',
  createdAt: 'internal',
  updatedAt: 'internal',
} as const satisfies Record<keyof CommitteeApplication, Audience>

// Read only to refuse a pseudonym equal to the company's name.
export const COMPANY_COLUMN_AUDIENCE = {
  id: 'internal',
  ownerId: 'internal',
  name: 'internal',
  profileVersionId: 'internal',
  preparedInWorkspaceId: 'internal',
  createdAt: 'internal',
  updatedAt: 'internal',
} as const satisfies Record<keyof Company, Audience>

export const CARD_COLUMN_AUDIENCES = {
  ShowcaseCard: SHOWCASE_CARD_COLUMN_AUDIENCE,
  Dossier: DOSSIER_COLUMN_AUDIENCE,
  FundingPlanLine: FUNDING_PLAN_LINE_COLUMN_AUDIENCE,
  Candidature: CANDIDATURE_COLUMN_AUDIENCE,
  CommitteeApplication: COMMITTEE_APPLICATION_COLUMN_AUDIENCE,
  Company: COMPANY_COLUMN_AUDIENCE,
} as const

// What a card is built from: its consent, the request as the narrowest level reads it, the plan's
// lines of that candidature, and the session that retained it, if any (`showcaseCommitteeOf`).
export interface CardSource {
  card: Pick<ShowcaseCard, 'pseudonym' | 'region'>
  dossier: Pick<Dossier, 'sector' | 'amountEur'>
  lines: ReadonlyArray<Pick<FundingPlanLine, 'amountEur' | 'state'>>
  committee: Committee | null
}

// THE projection of a card (@confluent/shared `PUBLIC_CARD_FIELDS`), copied field by field.
export function toPublicCard(source: CardSource): PublicCard {
  const { card, dossier, lines, committee } = source
  const totals = fundingPlanTotals(dossier.amountEur, lines)
  return {
    pseudonym: card.pseudonym,
    sector: dossier.sector,
    region: showcaseRegionOf(card.region),
    amountEur: dossier.amountEur,
    fundingPlan: {
      obtainedEur: totals.obtainedEur,
      requestedEur: totals.requestedEur,
      remainingEur: totals.remainingEur,
    },
    committee: committee
      ? { state: 'scheduled', session: publicSession(committee) }
      : { state: 'awaiting' },
  }
}

// The session by name and when only (E09.01's `toPublicCommittee`).
function publicSession(committee: Committee) {
  const session = toPublicCommittee(toView(committee))
  return { ...session, startsAt: session.startsAt.toISOString() }
}
