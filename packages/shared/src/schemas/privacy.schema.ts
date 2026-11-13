import { z } from 'zod'

// ROADMAP E10.10 — personal data: retention, export and deletion of an account. This file is the
// only place where these rules are written; the API applies them (`modules/privacy`), the site shows
// them (privacy page, « Mes données », the administrators' queue).

// ── Retention ────────────────────────────────────────────────────────────────────────────────────
//
// What the purge job removes, and when (days after the moment named). Run under an advisory lock,
// idempotent; the items not listed here are kept as long as what they belong to (an account, a
// request) exists. Off-server backups are not in place (D09: E11, end of project).
export const RETENTION_DAYS = {
  // Sign-in links (valid 15 min, single use): removed this long after their expiry.
  magicLinksAfterExpiry: 1,
  // Web sessions (refresh tokens, valid 7 days): removed this long after their expiry. Kept until
  // then, revoked or not, so that a replayed token is recognised.
  webSessionsAfterExpiry: 30,
  // AI applications' authorization requests (valid 10 min): this long after their expiry.
  oauthRequestsAfterExpiry: 1,
  // AI applications' codes and tokens (1 min, 1 h, 30 days): this long after their expiry.
  oauthTokensAfterExpiry: 30,
  // A connected application (at most 90 days): this long after it was revoked or expired.
  oauthGrantsAfterEnd: 30,
  // A notification already read: this long after it was created.
  readNotifications: 180,
  // The network details of the journal (IP address, browser): erased this long after the entry.
  journalNetworkDetails: 365,
  // A request sent from a structure's public form and refused: this long after the decision.
  refusedPublicRequests: 365,
} as const

// The retention of every kind of data, as the privacy page states it (the numbers above).
export const RETENTION_RULES: ReadonlyArray<{ data: string; rule: string }> = [
  {
    data: 'Compte, entreprises, demandes, réponses et documents',
    rule: 'Tant que le compte existe, puis supprimés lorsque sa suppression est traitée ; les fichiers des documents supprimés sont effacés du stockage.',
  },
  {
    data: 'Liens de connexion',
    rule: `Valables 15 minutes, à usage unique ; effacés ${RETENTION_DAYS.magicLinksAfterExpiry} jour après leur expiration.`,
  },
  {
    data: 'Sessions du site',
    rule: `Valables 7 jours ; effacées ${RETENTION_DAYS.webSessionsAfterExpiry} jours après leur expiration.`,
  },
  {
    data: 'Applications IA connectées',
    rule: `Autorisation de 90 jours au plus (jeton d’accès d’une heure, renouvelable pendant 30 jours) ; effacée ${RETENTION_DAYS.oauthGrantsAfterEnd} jours après sa révocation ou son expiration, avec ses jetons.`,
  },
  {
    data: 'Notifications',
    rule: `Une notification lue est effacée ${RETENTION_DAYS.readNotifications} jours après sa création ; une notification non lue reste affichée.`,
  },
  {
    data: 'Journal d’activité',
    rule: `Les faits (quelle action, quand, sur quelle demande) sont conservés tant que la demande ou la plateforme en a besoin ; l’adresse IP et le navigateur sont effacés ${RETENTION_DAYS.journalNetworkDetails} jours après l’entrée. Un compte supprimé n’y est plus nommé.`,
  },
  {
    data: 'Consultations des demandes',
    rule: 'Conservées avec la demande, pour que son porteur sache qui l’a lue ; le lecteur n’y est plus rattaché si son compte est supprimé.',
  },
  {
    data: 'Demandes envoyées depuis la page publique d’une structure',
    rule: `En attente jusqu’à la décision de la structure ; une demande refusée est effacée ${RETENTION_DAYS.refusedPublicRequests} jours après la décision.`,
  },
  {
    data: 'Demandes de suppression de compte',
    rule: 'Conservées comme preuve de leur traitement, sans adresse ni nom une fois le compte supprimé.',
  },
  {
    data: 'Sauvegardes',
    rule: 'Aucune sauvegarde hors serveur n’est en place à ce jour : elle sera décidée avant la mise en production.',
  },
]

// ── Export ───────────────────────────────────────────────────────────────────────────────────────
//
// The signed-in person downloads what is theirs (GET /v1/me/export), as one JSON file: their account,
// the companies they hold (not one a conseiller prepares for a structure) with their requests,
// answers, documents' names and versions (not the files: each is downloaded from the library), the
// shares they gave, the shares addressed to them (the request's name only while the share is
// active), their positions as an investor as « Mes positionnements » shows them, their memberships,
// notifications, connected applications, their own journal entries and readings, and their deletion
// requests. Never another person's answers, documents, positions or journal. Limited per account
// (`EXPORT_LIMITS`, counted under an advisory lock), journaled (`personal_data_exported`).
export const EXPORT_FORMAT = 'confluent.export.v1'

export const EXPORT_LIMITS = {
  perAccount: 5,
  windowMinutes: 60,
} as const

const iso = z.string().datetime()
const isoOrNull = iso.nullable()

const answerExport = z.object({ question: z.string(), value: z.string(), updatedAt: iso }).strict()

export const personalDataExportSchema = z
  .object({
    format: z.literal(EXPORT_FORMAT),
    exportedAt: iso,
    account: z
      .object({
        id: z.string(),
        email: z.string(),
        firstName: z.string().nullable(),
        lastName: z.string().nullable(),
        role: z.string(),
        locale: z.string(),
        createdAt: iso,
        emailVerifiedAt: isoOrNull,
      })
      .strict(),
    companies: z.array(
      z
        .object({
          id: z.string(),
          name: z.string(),
          createdAt: iso,
          profileAnswers: z.array(answerExport),
          documents: z.array(
            z
              .object({
                filename: z.string(),
                type: z.string(),
                versions: z.array(
                  z
                    .object({
                      version: z.number().int(),
                      mimetype: z.string(),
                      size: z.number().int(),
                      createdAt: iso,
                    })
                    .strict(),
                ),
              })
              .strict(),
          ),
          requests: z.array(
            z
              .object({
                id: z.string(),
                name: z.string(),
                slug: z.string(),
                summary: z.string().nullable(),
                objective: z.string().nullable(),
                description: z.string().nullable(),
                amountEur: z.number().int().nullable(),
                financingTypes: z.array(z.string()),
                publicationStatus: z.string(),
                submittedAt: isoOrNull,
                createdAt: iso,
                sharesGiven: z.array(
                  z
                    .object({
                      recipientEmail: z.string(),
                      accessLevel: z.string(),
                      status: z.string(),
                      createdAt: iso,
                      revokedAt: isoOrNull,
                    })
                    .strict(),
                ),
                candidatures: z.array(
                  z
                    .object({
                      workspaceName: z.string(),
                      financingStatus: z.string(),
                      submittedAt: isoOrNull,
                      createdAt: iso,
                      answers: z.array(answerExport),
                    })
                    .strict(),
                ),
              })
              .strict(),
          ),
        })
        .strict(),
    ),
    sharesReceived: z.array(
      z
        .object({
          requestName: z.string().nullable(),
          accessLevel: z.string(),
          status: z.string(),
          createdAt: iso,
          revokedAt: isoOrNull,
        })
        .strict(),
    ),
    investorPositions: z.array(
      z
        .object({
          requestName: z.string().nullable(),
          interest: z.object({ nameVisible: z.boolean(), markedAt: iso }).strict().nullable(),
          pledge: z
            .object({
              intention: z.string(),
              amountEur: z.number().int(),
              comment: z.string().nullable(),
              showName: z.boolean(),
              showAmount: z.boolean(),
              updatedAt: iso,
            })
            .strict()
            .nullable(),
          shownToStructures: z.array(z.string()),
        })
        .strict(),
    ),
    workspaceMemberships: z.array(
      z
        .object({
          workspaceName: z.string(),
          role: z.string(),
          organization: z.string().nullable(),
          canManageWorkspace: z.boolean(),
          invitedAt: iso,
          deactivatedAt: isoOrNull,
        })
        .strict(),
    ),
    notifications: z.array(
      z
        .object({
          title: z.string(),
          body: z.string().nullable(),
          createdAt: iso,
          readAt: isoOrNull,
        })
        .strict(),
    ),
    connectedApplications: z.array(
      z
        .object({
          application: z.string(),
          permissions: z.array(z.string()),
          workspaces: z.array(z.string()),
          authorizedAt: iso,
          lastUsedAt: isoOrNull,
          expiresAt: iso,
          revokedAt: isoOrNull,
        })
        .strict(),
    ),
    activity: z.array(
      z
        .object({
          action: z.string(),
          at: iso,
          // The application through which it was done, if any.
          application: z.string().nullable(),
          tool: z.string().nullable(),
          ip: z.string().nullable(),
          userAgent: z.string().nullable(),
        })
        .strict(),
    ),
    readings: z.array(
      z
        .object({
          channel: z.string(),
          startedAt: iso,
          lastSeenAt: iso,
          activeSeconds: z.number().int().nullable(),
        })
        .strict(),
    ),
    deletionRequests: z.array(
      z
        .object({
          status: z.string(),
          requestedAt: iso,
          decidedAt: isoOrNull,
          declineNote: z.string().nullable(),
        })
        .strict(),
    ),
  })
  .strict()
export type PersonalDataExport = z.infer<typeof personalDataExportSchema>

// ── Deletion of an account ───────────────────────────────────────────────────────────────────────
//
// A request, then an administrator's decision — never an immediate self-service deletion:
//
//  * The person asks from « Mes données », after a confirmation; at most one pending request per
//    account (partial unique index); they may withdraw it while pending. Nothing changes meanwhile:
//    the account stays usable, so that they can withdraw what blocks the deletion themselves.
//  * Blockers (re-read when an administrator processes it, under the account's and its requests'
//    locks): what deleting would take from other people without their say, which the person can
//    withdraw from the site — a share still open (pending or active), a publication in a structure's
//    pool, a card on a public page, a candidature sent and still open (preparing or in committee:
//    the owner can abandon it); a company a conseiller prepares for a structure (to transfer or
//    delete first); the platform's last active administrator. While one remains, the request can
//    only wait or be declined.
//  * Processed (`completed`), in one transaction: the account and everything it alone holds are
//    deleted — its companies, requests, answers, documents (their files go to the storage cleanup),
//    closed candidatures (the structures keep their journal), its marks of interest, pledges and
//    consents, memberships, notifications, sessions, connected applications and tokens. Kept, without
//    naming the person: the journal's facts (its entries no longer point to the account; IP address,
//    browser and assistant instructions of its own entries erased; its address replaced wherever it
//    is a whole value of an entry), the views it made of others' requests (no longer linked to it),
//    the notes, decisions and validations it wrote for a structure (their author left blank), the
//    request itself (`subjectRef`). The shares addressed to its address are revoked and their address
//    replaced by `subjectRef`; the requests sent with its address from public forms are deleted. A
//    confirmation email is sent to the former address after the commit, its outcome recorded.
//  * Declined (`declined`), with a note the person reads, and a notification.
export const ACCOUNT_DELETION_STATUSES = ['pending', 'completed', 'declined', 'cancelled'] as const
export type AccountDeletionStatus = (typeof ACCOUNT_DELETION_STATUSES)[number]

export const ACCOUNT_DELETION_STATUS_LABELS: Record<AccountDeletionStatus, string> = {
  pending: 'En attente de traitement',
  completed: 'Compte supprimé',
  declined: 'Refusée',
  cancelled: 'Retirée',
}

export const ACCOUNT_DELETION_BLOCKERS = [
  'last_admin',
  'prepared_company',
  'open_share',
  'pool_publication',
  'showcase_card',
  'open_candidature',
] as const
export type AccountDeletionBlocker = (typeof ACCOUNT_DELETION_BLOCKERS)[number]

// What the person (or the administrator) reads about each blocker, and where it is withdrawn.
export const ACCOUNT_DELETION_BLOCKER_LABELS: Record<AccountDeletionBlocker, string> = {
  last_admin:
    'Dernier compte administrateur actif : un autre administrateur doit exister avant sa suppression.',
  prepared_company:
    'Entreprise préparée pour une structure : transférez-la à son porteur ou supprimez-la d’abord.',
  open_share: 'Partage encore ouvert : révoquez-le depuis la page de la demande.',
  pool_publication:
    'Demande publiée dans le vivier d’une structure : retirez la publication depuis la candidature.',
  showcase_card:
    'Carte affichée sur la page publique d’une structure : retirez-la depuis la candidature.',
  open_candidature:
    'Candidature envoyée encore en cours : abandonnez-la depuis la candidature (la structure en est informée).',
}

export const ACCOUNT_DELETION_NOTE_MAX = 1000

export const accountDeletionBlockerSchema = z
  .object({
    kind: z.enum(ACCOUNT_DELETION_BLOCKERS),
    // The request or company concerned (its name), null for the last administrator.
    subject: z.string().nullable(),
    // Where the person withdraws it in the site, when it is theirs to withdraw.
    href: z.string().nullable(),
  })
  .strict()
export type AccountDeletionBlockerView = z.infer<typeof accountDeletionBlockerSchema>

// What processing the request would delete (counts), and what blocks it now.
export const accountDeletionImpactSchema = z
  .object({
    companies: z.number().int().min(0),
    requests: z.number().int().min(0),
    documents: z.number().int().min(0),
    closedCandidatures: z.number().int().min(0),
    investorPositions: z.number().int().min(0),
    memberships: z.number().int().min(0),
    connectedApplications: z.number().int().min(0),
    sharesReceived: z.number().int().min(0),
    blockers: z.array(accountDeletionBlockerSchema),
  })
  .strict()
export type AccountDeletionImpact = z.infer<typeof accountDeletionImpactSchema>

// The person's own request (GET /v1/me/deletion-request: the latest, or null).
export const myDeletionRequestSchema = z
  .object({
    id: z.string().uuid(),
    status: z.enum(ACCOUNT_DELETION_STATUSES),
    requestedAt: iso,
    decidedAt: isoOrNull,
    declineNote: z.string().nullable(),
    // Pending only.
    impact: accountDeletionImpactSchema.nullable(),
  })
  .strict()
export type MyDeletionRequest = z.infer<typeof myDeletionRequestSchema>

// GET /v1/me/deletion-request: the latest request, `null` without any.
export const myDeletionRequestStateSchema = z
  .object({ request: myDeletionRequestSchema.nullable() })
  .strict()
export type MyDeletionRequestState = z.infer<typeof myDeletionRequestStateSchema>

export const requestAccountDeletionSchema = z.object({ confirm: z.literal(true) }).strict()
export type RequestAccountDeletion = z.infer<typeof requestAccountDeletionSchema>

// The administrators' queue (GET /v1/admin/deletion-requests).
export const adminDeletionRequestSchema = z
  .object({
    id: z.string().uuid(),
    status: z.enum(ACCOUNT_DELETION_STATUSES),
    // The pseudonym kept once the account is gone.
    subjectRef: z.string(),
    // While the account exists.
    account: z
      .object({
        id: z.string(),
        email: z.string(),
        name: z.string().nullable(),
        role: z.string(),
        createdAt: iso,
      })
      .strict()
      .nullable(),
    requestedAt: iso,
    decidedAt: isoOrNull,
    declineNote: z.string().nullable(),
    // Completed: what was deleted, and whether the confirmation email left.
    summary: z.record(z.string(), z.number().int()).nullable(),
    confirmationEmail: z.enum(['sent', 'failed']).nullable(),
    // Pending only.
    impact: accountDeletionImpactSchema.nullable(),
  })
  .strict()
export type AdminDeletionRequest = z.infer<typeof adminDeletionRequestSchema>

export const ADMIN_DELETION_FILTERS = ['pending', 'decided'] as const
export const adminDeletionQuerySchema = z
  .object({ status: z.enum(ADMIN_DELETION_FILTERS).default('pending') })
  .strict()

export const completeAccountDeletionSchema = z.object({ confirm: z.literal(true) }).strict()
export const declineAccountDeletionSchema = z
  .object({ note: z.string().trim().min(1).max(ACCOUNT_DELETION_NOTE_MAX) })
  .strict()
export type DeclineAccountDeletion = z.infer<typeof declineAccountDeletionSchema>
