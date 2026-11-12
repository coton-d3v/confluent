import { Injectable } from '@nestjs/common'
import {
  ACCESS_LEVEL_LABELS,
  ACCESS_LEVELS,
  CLASSIFICATION_COLUMN_LABELS,
  OWNER_HISTORY_PAGE_SIZE,
  classificationValueText,
  type AccessLevel,
  type OwnerHistoryEntry,
  type OwnerHistoryFilter,
  type OwnerHistoryQuery,
  type ReadingChannel,
} from '@confluent/shared'
import type { AuditLog, QuestionnaireField, ReadingSession, ShareLink } from '@prisma/client'
import { PrismaService } from '../../prisma/prisma.service'
import { DossiersService } from '../dossiers/dossiers.service'
import { ReadingSessionsService } from '../reading-sessions/reading-sessions.service'
import { readChoices } from '../questionnaires/questionnaire-structure'
import { actionsFor, listsConsultations, ownerRule, type ShownAction } from './owner-history.rules'

// @confluent/shared `ownerHistoryPageSchema`, dates as Date.
export interface OwnerHistoryView {
  filter: OwnerHistoryFilter
  page: number
  pageSize: number
  total: number
  items: Array<
    Omit<OwnerHistoryEntry, 'occurredAt' | 'consultation'> & {
      occurredAt: Date
      consultation: {
        channel: ReadingChannel
        lastSeenAt: Date
        activeSeconds: number | null
      } | null
    }
  >
}
type Item = OwnerHistoryView['items'][number]

// One row of either source, in the history's order: the latest first; at the same instant, the
// journal before the sessions, then by id — the order each source is read in, so that the first
// rows of each are the first rows of both.
type Row =
  | { at: Date; source: 0; id: string; entry: AuditLog }
  | { at: Date; source: 1; id: string; session: ReadingSession }
const historyOrder = (a: Row, b: Row) =>
  b.at.getTime() - a.at.getTime() || a.source - b.source || (a.id < b.id ? 1 : a.id > b.id ? -1 : 0)

// Long answers are cut: the whole answer is read on the request itself.
const VALUE_SHOWN = 300
const cut = (v: string) => (v.length > VALUE_SHOWN ? `${v.slice(0, VALUE_SHOWN)}…` : v)
const levelOf = (v: unknown): AccessLevel | null =>
  typeof v === 'string' && (ACCESS_LEVELS as readonly string[]).includes(v)
    ? (v as AccessLevel)
    : null
const text = (v: unknown): string | null => (typeof v === 'string' && v.trim() ? v : null)
const metadataOf = (entry: AuditLog): Record<string, unknown> =>
  entry.metadata && typeof entry.metadata === 'object' && !Array.isArray(entry.metadata)
    ? (entry.metadata as Record<string, unknown>)
    : {}

// An answer as its owner reads it (the site's `answerLabel`): « Oui »/« Non », a French date, a
// choice's label; « (vide) » for none.
function answerText(field: QuestionnaireField | undefined, value: unknown): string {
  if (typeof value !== 'string' || value === '') return '(vide)'
  if (field?.fieldType === 'checkbox')
    return value === 'true' ? 'Oui' : value === 'false' ? 'Non' : value
  if (field?.fieldType === 'date' && /^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return value.split('-').reverse().join('/')
  }
  return cut(readChoices(field?.choices).find((c) => c.key === value)?.label ?? value)
}

// What the owner reads of the application that asked for a step of their request (E04.08): its
// name, never what it was asked.
function channelDetail(metadata: Record<string, unknown>) {
  if (metadata.channel === 'mcp') {
    return [{ label: 'Demandé via', value: `l’application ${text(metadata.clientName) ?? 'IA'}` }]
  }
  return metadata.channel === 'site' ? [{ label: 'Demandé via', value: 'le site' }] : []
}

// ROADMAP E07.09 — the history of a request for its owner (@confluent/shared
// `owner-history.schema.ts`): the journal through the closed list of `owner-history.rules.ts`, and the
// consultations of its direct shares (E07.08), merged the latest first, one page at a time.
@Injectable()
export class OwnerHistoryService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly dossiers: DossiersService,
    private readonly readings: ReadingSessionsService,
  ) {}

  async forOwner(
    dossierId: string,
    userId: string,
    query: OwnerHistoryQuery,
  ): Promise<OwnerHistoryView> {
    await this.dossiers.getByIdForUser(dossierId, userId)
    const filter = query.filter ?? 'all'
    const page = query.page ?? 1
    const pageSize = OWNER_HISTORY_PAGE_SIZE
    // The first `page` pages of each source hold the first `page` pages of both.
    const take = page * pageSize
    const actions = actionsFor(filter)
    const journal = { dossierId, actionType: { in: actions } }
    const withSessions = listsConsultations(filter)
    const [entries, sessions, journalTotal, sessionTotal] = await Promise.all([
      actions.length === 0
        ? Promise.resolve([] as AuditLog[])
        : this.prisma.auditLog.findMany({
            where: journal,
            orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
            take,
          }),
      withSessions
        ? this.readings.latestShareSessions(dossierId, take)
        : Promise.resolve([] as ReadingSession[]),
      actions.length === 0 ? Promise.resolve(0) : this.prisma.auditLog.count({ where: journal }),
      withSessions ? this.readings.countShareSessions(dossierId) : Promise.resolve(0),
    ])
    const rows: Row[] = [
      ...entries.map((entry) => ({ at: entry.createdAt, source: 0 as const, id: entry.id, entry })),
      ...sessions.map((session) => ({
        at: session.startedAt,
        source: 1 as const,
        id: session.id,
        session,
      })),
    ]
      .sort(historyOrder)
      .slice((page - 1) * pageSize, take)
    return {
      filter,
      page,
      pageSize,
      total: journalTotal + sessionTotal,
      items: await this.describe(dossierId, rows),
    }
  }

  private async describe(dossierId: string, rows: Row[]): Promise<Item[]> {
    const linkIds = new Set<string>()
    const fieldIds = new Set<string>()
    for (const row of rows) {
      const linkId = row.source === 0 ? row.entry.shareLinkId : row.session.shareLinkId
      if (linkId) linkIds.add(linkId)
      if (row.source === 0 && row.entry.actionType === 'admin_edited_field') {
        const fieldId = text(metadataOf(row.entry).fieldId)
        if (fieldId) fieldIds.add(fieldId)
      }
    }
    const [links, fields] = await Promise.all([
      linkIds.size === 0
        ? Promise.resolve([] as ShareLink[])
        : this.prisma.shareLink.findMany({ where: { id: { in: [...linkIds] } } }),
      fieldIds.size === 0
        ? Promise.resolve([] as QuestionnaireField[])
        : this.prisma.questionnaireField.findMany({ where: { id: { in: [...fieldIds] } } }),
    ])
    // Only this request's shares: the address the owner chose.
    const recipients = new Map(
      links.filter((l) => l.dossierId === dossierId).map((l) => [l.id, l.recipientEmail]),
    )
    const fieldsById = new Map(fields.map((f) => [f.id, f]))
    return rows.flatMap((row): Item[] => {
      if (row.source === 1) {
        const { session } = row
        const email = (session.shareLinkId && recipients.get(session.shareLinkId)) ?? null
        return [
          {
            kind: 'consultation',
            occurredAt: session.startedAt,
            byAdministration: false,
            summary: `Consultation par ${email ?? 'un destinataire'}`,
            recipientEmail: email,
            details: [],
            consultation: {
              channel: session.channel === 'opportunity' ? 'opportunity' : 'share',
              lastSeenAt: session.lastSeenAt,
              activeSeconds: session.activeMs === null ? null : Math.round(session.activeMs / 1000),
            },
          },
        ]
      }
      const rule = ownerRule(row.entry.actionType)
      if (!rule) return []
      return [this.journalItem(row.entry, rule, recipients, fieldsById)]
    })
  }

  private journalItem(
    entry: AuditLog,
    rule: ShownAction,
    recipients: Map<string, string>,
    fields: Map<string, QuestionnaireField>,
  ): Item {
    const metadata = metadataOf(entry)
    const email =
      (entry.shareLinkId && recipients.get(entry.shareLinkId)) ||
      text(metadata.recipientEmail) ||
      null
    const recipient = email ?? 'un destinataire'
    const level = (v: unknown) => {
      const known = levelOf(v)
      return known ? ACCESS_LEVEL_LABELS[known] : null
    }
    const base = {
      kind: rule.kind,
      occurredAt: entry.createdAt,
      byAdministration: rule.byAdministration,
      recipientEmail: null as string | null,
      details: [] as Item['details'],
      consultation: null,
    }
    switch (rule.kind) {
      case 'share_created': {
        const granted = level(metadata.accessLevel)
        return {
          ...base,
          summary: `Accès ouvert à ${recipient}`,
          recipientEmail: email,
          details: granted ? [{ label: 'Niveau', value: granted }] : [],
        }
      }
      case 'share_level_changed': {
        const from = level(metadata.from)
        const to = level(metadata.to)
        return {
          ...base,
          summary: `Niveau d’accès de ${recipient} modifié`,
          recipientEmail: email,
          details: [
            ...(from ? [{ label: 'Avant', value: from }] : []),
            ...(to ? [{ label: 'Après', value: to }] : []),
          ],
        }
      }
      case 'share_revoked':
        return {
          ...base,
          summary: rule.byAdministration
            ? `Accès de ${recipient} révoqué par l’administration`
            : `Accès de ${recipient} révoqué`,
          recipientEmail: email,
        }
      case 'answer_edited': {
        const field = fields.get(text(metadata.fieldId) ?? '')
        return {
          ...base,
          summary: field
            ? `Réponse à « ${field.label} » modifiée par l’administration`
            : 'Réponse à une question modifiée par l’administration',
          details: [
            { label: 'Avant', value: answerText(field, metadata.oldValue) },
            { label: 'Après', value: answerText(field, metadata.newValue) },
          ],
        }
      }
      case 'classification_updated': {
        const changes = Array.isArray(metadata.changes) ? metadata.changes : []
        return {
          ...base,
          summary:
            'Classification de la demande mise à jour par l’administration, après un changement de ses règles',
          details: changes.flatMap((c: unknown) => {
            const change = c as { column?: unknown; from?: unknown; to?: unknown }
            const column = text(change.column)
            const label =
              column && Object.hasOwn(CLASSIFICATION_COLUMN_LABELS, column)
                ? CLASSIFICATION_COLUMN_LABELS[column as keyof typeof CLASSIFICATION_COLUMN_LABELS]
                : null
            if (!column || !label) return []
            return [
              {
                label,
                value: `${classificationValueText(column, change.from)} → ${classificationValueText(column, change.to)}`,
              },
            ]
          }),
        }
      }
      case 'document_added':
        return { ...base, summary: 'Document déposé par l’administration' }
      case 'request_submitted':
        return { ...base, summary: 'Dossier soumis', details: channelDetail(metadata) }
      case 'request_published':
        return {
          ...base,
          summary: 'Demande publiée : sa présentation est montrée à ceux qui y ont accès',
          details: channelDetail(metadata),
        }
      case 'request_unpublished':
        return { ...base, summary: 'Demande repassée en brouillon' }
      case 'request_archived':
        return { ...base, summary: 'Demande archivée' }
      case 'request_unarchived':
        return { ...base, summary: 'Demande désarchivée' }
      case 'consultation':
        // Consultations come from the reading sessions, never from the journal.
        return { ...base, summary: 'Consultation' }
    }
  }
}
