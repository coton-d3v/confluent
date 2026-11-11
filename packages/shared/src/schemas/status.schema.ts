import { z } from 'zod'

// ROADMAP E06.01, decision D03 « Statuts et clôture » — STILL TO BE CONFIRMED by the product owner.
// This file is the only place where the two status machines are described; the API applies them
// (under a row lock, journaled) and the site only offers the transitions they allow. The closed
// lists are kept equal to the CHECK constraints of migration 20261117000000_statuses.
//
//  * The publication of a financing request (its dossier) — one status per request, decided by its
//    owner: whether the request is presented as ready (`published`), still prepared (`draft`) or
//    closed (`archived`).
//  * The financing status of a request in each workspace it is presented to — one per candidature,
//    independent from one workspace to another and from the publication.

// ── Publication of a financing request ──────────────────────────────────────────────────────────

export const DOSSIER_PUBLICATION_STATUSES = ['draft', 'published', 'archived'] as const
export const dossierPublicationStatusSchema = z.enum(DOSSIER_PUBLICATION_STATUSES)
export type DossierPublicationStatus = z.infer<typeof dossierPublicationStatusSchema>

export const DOSSIER_PUBLICATION_STATUS_LABELS: Record<DossierPublicationStatus, string> = {
  draft: 'Brouillon',
  published: 'Publiée',
  archived: 'Archivée',
}

// Closed by default: an unknown value is read as a draft, which diffuses nothing.
export function publicationStatusOf(raw: string | null | undefined): DossierPublicationStatus {
  return raw === 'published' || raw === 'archived' ? raw : 'draft'
}

export function isPublished(dossier: { publicationStatus: string | null | undefined }): boolean {
  return dossier.publicationStatus === 'published'
}

export function isArchived(dossier: { publicationStatus: string | null | undefined }): boolean {
  return dossier.publicationStatus === 'archived'
}

// The owner of the request — whoever holds its company (`holdsCompany`) — is the only one who
// changes its publication; publishing also needs its presentation complete and its company owned by
// its entrepreneur (E05.07, E05.08). Archiving closes the request: it is no longer presented to the
// recipients of its shares (as a draft), cannot be published, edited nor presented to a new
// structure until it is unarchived — back to a draft, to be published again if wanted. It changes
// neither its shares nor its candidatures: each structure keeps its own financing status.
export const PUBLICATION_ACTIONS = ['publish', 'unpublish', 'archive', 'unarchive'] as const
export type PublicationAction = (typeof PUBLICATION_ACTIONS)[number]

export const PUBLICATION_TRANSITIONS: Record<
  PublicationAction,
  { from: ReadonlyArray<DossierPublicationStatus>; to: DossierPublicationStatus }
> = {
  publish: { from: ['draft'], to: 'published' },
  unpublish: { from: ['published'], to: 'draft' },
  archive: { from: ['draft', 'published'], to: 'archived' },
  unarchive: { from: ['archived'], to: 'draft' },
}

// `unchanged`: already there (asking again changes nothing); `allowed`: the transition applies;
// `refused`: not from this status.
export function publicationTransition(
  current: string | null | undefined,
  action: PublicationAction,
): 'unchanged' | 'allowed' | 'refused' {
  const status = publicationStatusOf(current)
  const { from, to } = PUBLICATION_TRANSITIONS[action]
  if (status === to) return 'unchanged'
  return from.includes(status) ? 'allowed' : 'refused'
}

// ── Financing status of a request in a workspace (its candidature) ──────────────────────────────

export const FINANCING_STATUSES = [
  'preparing',
  'in_committee',
  'funded',
  'refused',
  'abandoned',
] as const
export const financingStatusSchema = z.enum(FINANCING_STATUSES)
export type FinancingStatus = z.infer<typeof financingStatusSchema>

export const FINANCING_STATUS_LABELS: Record<FinancingStatus, string> = {
  preparing: 'En préparation',
  in_committee: 'En comité',
  funded: 'Financé',
  refused: 'Refusé',
  abandoned: 'Abandonné',
}

// The statuses that close the follow-up in a workspace (each can be reopened, see below).
export const CLOSED_FINANCING_STATUSES: ReadonlyArray<FinancingStatus> = [
  'funded',
  'refused',
  'abandoned',
]

// Closed by default: an unknown value is read as the initial status, from which nothing is decided.
export function financingStatusOf(raw: string | null | undefined): FinancingStatus {
  return (FINANCING_STATUSES as ReadonlyArray<string>).includes(raw ?? '')
    ? (raw as FinancingStatus)
    : 'preparing'
}

// Who changes a financing status: the owner of the request (`owner`), or the workspace — its active
// conseillers, with or without the right to manage it, and Confluent administrators, the same people
// who read its candidatures (`canReviewCandidatures`). Investors, other workspaces and share
// recipients never do. A candidature starts `preparing` when it is created and changes only once
// sent: a draft is its owner's alone.
export const FINANCING_STATUS_ACTORS = ['owner', 'workspace'] as const
export type FinancingStatusActor = (typeof FINANCING_STATUS_ACTORS)[number]

export const FINANCING_STATUS_ACTOR_LABELS: Record<FinancingStatusActor, string> = {
  owner: 'Porteur de projet',
  workspace: 'Structure',
}

// Every allowed transition, and who may make it; anything else is refused (closed by default).
// The structure decides the committee, the financing and the refusal; either side records that the
// entrepreneur gives up; a closed status is reopened back to `preparing` — by the structure, or by
// the owner for their own abandonment only.
export const FINANCING_STATUS_TRANSITIONS: ReadonlyArray<{
  from: FinancingStatus
  to: FinancingStatus
  by: ReadonlyArray<FinancingStatusActor>
}> = [
  { from: 'preparing', to: 'in_committee', by: ['workspace'] },
  { from: 'in_committee', to: 'preparing', by: ['workspace'] },
  { from: 'preparing', to: 'funded', by: ['workspace'] },
  { from: 'in_committee', to: 'funded', by: ['workspace'] },
  { from: 'preparing', to: 'refused', by: ['workspace'] },
  { from: 'in_committee', to: 'refused', by: ['workspace'] },
  { from: 'preparing', to: 'abandoned', by: ['owner', 'workspace'] },
  { from: 'in_committee', to: 'abandoned', by: ['owner', 'workspace'] },
  { from: 'abandoned', to: 'preparing', by: ['owner', 'workspace'] },
  { from: 'refused', to: 'preparing', by: ['workspace'] },
  { from: 'funded', to: 'preparing', by: ['workspace'] },
]

// `allowed`; `forbidden`: allowed to the other side only; `impossible`: allowed to nobody.
export function financingTransition(
  from: FinancingStatus,
  to: FinancingStatus,
  actor: FinancingStatusActor,
): 'allowed' | 'forbidden' | 'impossible' {
  const transition = FINANCING_STATUS_TRANSITIONS.find((t) => t.from === from && t.to === to)
  if (!transition) return 'impossible'
  return transition.by.includes(actor) ? 'allowed' : 'forbidden'
}

// The statuses an actor may move a candidature to from its current one, in the order of the list.
export function financingTransitionsFor(
  from: FinancingStatus,
  actor: FinancingStatusActor,
): FinancingStatus[] {
  return FINANCING_STATUSES.filter((to) => financingTransition(from, to, actor) === 'allowed')
}

// The name of the action that moves a candidature to a status, as the site offers it.
export function financingActionLabel(from: FinancingStatus, to: FinancingStatus): string {
  if (to === 'preparing') {
    return from === 'in_committee' ? 'Revenir en préparation' : 'Rouvrir'
  }
  return {
    in_committee: 'Passer en comité',
    funded: 'Marquer financé',
    refused: 'Marquer refusé',
    abandoned: 'Abandonner',
  }[to]
}

// The status the client saw (`from`) and the one it asks for: a change made meanwhile by someone
// else is refused (409) rather than overwritten.
export const changeFinancingStatusSchema = z
  .object({ from: financingStatusSchema, to: financingStatusSchema })
  .strict()
  .refine((v) => v.from !== v.to, {
    message: 'Choisissez un statut différent du statut actuel.',
    path: ['to'],
  })

export type ChangeFinancingStatusInput = z.infer<typeof changeFinancingStatusSchema>

// One change of a candidature's financing status, as its owner reads it: which side made it, never
// who among the structure's members.
export const financingStatusChangeSchema = z.object({
  from: financingStatusSchema,
  to: financingStatusSchema,
  by: z.enum(FINANCING_STATUS_ACTORS),
  changedAt: z.string().datetime(),
})

// As the structure reads it: who made it, too.
export const receivedFinancingStatusChangeSchema = financingStatusChangeSchema.extend({
  actor: z
    .object({
      email: z.string(),
      firstName: z.string().nullable(),
      lastName: z.string().nullable(),
    })
    .nullable(),
})

export type FinancingStatusChange = z.infer<typeof financingStatusChangeSchema>
export type ReceivedFinancingStatusChange = z.infer<typeof receivedFinancingStatusChangeSchema>
