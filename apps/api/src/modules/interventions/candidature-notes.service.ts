import { Injectable } from '@nestjs/common'
import { CANDIDATURE_NOTE_LIMITS } from '@confluent/shared'
import type { Candidature, CandidatureNote, Prisma } from '@prisma/client'
import { PrismaService } from '../../prisma/prisma.service'
import { AuditService } from '../audit/audit.service'
import { CandidaturesService, type CandidatureParty } from '../candidatures/candidatures.service'
import type { WorkspaceActor } from '../workspaces/workspace-access'
import { CandidatureNoteErrors } from './candidature-note-errors'
import {
  InterventionJournalService,
  type InterventionJournalView,
} from './intervention-journal.service'

type NoteChange = 'created' | 'edited' | 'deleted'

// The internal notes of a workspace on a candidature it received (ROADMAP E06.08). Written by the
// workspace's side of the candidature — its active conseillers and Confluent administrators, on a
// sent candidature (`CandidaturesService.reachAs` / `lockAs`, at each request and again under the
// candidature's row lock) —; only their author rewrites or deletes them, from the version they read
// (a note changed meanwhile is refused, never overwritten). Deleting erases the text and keeps the
// trace. The owner of the request has no route here, and no other view of the candidature reads
// this table: the notes never reach the entrepreneur, an investor, another workspace, a share
// recipient or an MCP tool. Each change is journaled (`candidature_note_updated`) without the text,
// and that entry is kept out of the owner's audit log (`AuditLogService`).
@Injectable()
export class CandidatureNotesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly candidatures: CandidaturesService,
    private readonly journal: InterventionJournalService,
    private readonly audit: AuditService,
  ) {}

  async create(
    actor: WorkspaceActor,
    workspaceId: string,
    candidatureId: string,
    input: { body: string },
  ): Promise<InterventionJournalView> {
    const { candidature, note } = await this.write(
      actor,
      workspaceId,
      candidatureId,
      async (tx, current) => {
        const count = await tx.candidatureNote.count({ where: { candidatureId: current.id } })
        if (count >= CANDIDATURE_NOTE_LIMITS.perCandidature) throw CandidatureNoteErrors.tooMany()
        return tx.candidatureNote.create({
          data: {
            candidatureId: current.id,
            workspaceId: current.workspaceId,
            body: input.body,
            authorId: actor.id,
          },
        })
      },
    )
    await this.record(actor, candidature, note, 'created')
    return this.journal.view(actor, candidature)
  }

  // The same text again writes nothing.
  async edit(
    actor: WorkspaceActor,
    workspaceId: string,
    candidatureId: string,
    noteId: string,
    input: { body: string; version: number },
  ): Promise<InterventionJournalView> {
    const { candidature, note } = await this.write(
      actor,
      workspaceId,
      candidatureId,
      async (tx, current) => {
        const note = await authoredNote(tx, actor, current, noteId, input.version)
        if (note.body === input.body) return null
        return tx.candidatureNote.update({
          where: { id: note.id },
          data: { body: input.body, editedAt: new Date(), version: note.version + 1 },
        })
      },
    )
    if (note) await this.record(actor, candidature, note, 'edited')
    return this.journal.view(actor, candidature)
  }

  async remove(
    actor: WorkspaceActor,
    workspaceId: string,
    candidatureId: string,
    noteId: string,
    version: number,
  ): Promise<InterventionJournalView> {
    const { candidature, note } = await this.write(
      actor,
      workspaceId,
      candidatureId,
      async (tx, current) => {
        const note = await authoredNote(tx, actor, current, noteId, version)
        return tx.candidatureNote.update({
          where: { id: note.id },
          data: { body: null, deletedAt: new Date(), version: note.version + 1 },
        })
      },
    )
    await this.record(actor, candidature, note, 'deleted')
    return this.journal.view(actor, candidature)
  }

  // Nothing is told to whoever may not reach the candidature; then its row is locked and the access
  // read again after the lock — a conseiller deactivated meanwhile writes nothing.
  private async write<T>(
    actor: WorkspaceActor,
    workspaceId: string,
    candidatureId: string,
    fn: (tx: Prisma.TransactionClient, candidature: Candidature) => Promise<T>,
  ): Promise<{ candidature: Candidature; note: T }> {
    const party: CandidatureParty = { side: 'workspace', actor, workspaceId }
    await this.candidatures.reachAs(party, candidatureId)
    return this.prisma.$transaction(async (tx) => {
      const candidature = await this.candidatures.lockAs(tx, party, candidatureId)
      return { candidature, note: await fn(tx, candidature) }
    })
  }

  // Never the text: the journal of the request outlives a deleted note, its text must not.
  private record(
    actor: WorkspaceActor,
    candidature: Candidature,
    note: CandidatureNote,
    change: NoteChange,
  ) {
    return this.audit.record({
      actionType: 'candidature_note_updated',
      actorId: actor.id,
      dossierId: candidature.dossierId,
      metadata: {
        candidatureId: candidature.id,
        workspaceId: candidature.workspaceId,
        noteId: note.id,
        change,
        version: note.version,
      },
    })
  }
}

// The candidature's note, still there, written by `actor`, at the version the client saw.
async function authoredNote(
  tx: Prisma.TransactionClient,
  actor: WorkspaceActor,
  candidature: Candidature,
  noteId: string,
  version: number,
): Promise<CandidatureNote> {
  const note = await tx.candidatureNote.findFirst({
    where: { id: noteId, candidatureId: candidature.id },
  })
  if (!note) throw CandidatureNoteErrors.notFound()
  if (note.authorId !== actor.id) throw CandidatureNoteErrors.notAuthor()
  if (note.deletedAt) throw CandidatureNoteErrors.deleted()
  if (note.version !== version) throw CandidatureNoteErrors.changed(note.version)
  return note
}
