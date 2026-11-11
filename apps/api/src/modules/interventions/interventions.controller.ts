import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common'
import {
  ApiBadRequestResponse,
  ApiBearerAuth,
  ApiConflictResponse,
  ApiCreatedResponse,
  ApiForbiddenResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiParam,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger'
import {
  createCandidatureNoteSchema,
  deleteCandidatureNoteQuerySchema,
  updateCandidatureNoteSchema,
} from '@confluent/shared'
import { createZodDto } from 'nestjs-zod'
import { CurrentUser } from '../../common/decorators/current-user.decorator'
import type { AuthenticatedUser } from '../auth/strategies/jwt.strategy'
import { WorkspaceAccessGuard } from '../workspaces/workspace-access.guard'
import { CandidatureNotesService } from './candidature-notes.service'
import {
  InterventionJournalService,
  type InterventionJournalView,
} from './intervention-journal.service'

class CreateCandidatureNoteDto extends createZodDto(createCandidatureNoteSchema) {}
class UpdateCandidatureNoteDto extends createZodDto(updateCandidatureNoteSchema) {}
class DeleteCandidatureNoteQueryDto extends createZodDto(deleteCandidatureNoteQuerySchema) {}

const uuid = new ParseUUIDPipe()

const INTERNAL =
  ' Les notes internes et ce journal restent à la structure : jamais lus par l’entreprise, un ' +
  'investisseur, une autre structure, un destinataire de partage ni un outil MCP.'

const JOURNAL =
  '`entries`, la plus récente d’abord : les notes internes (`note`, texte `null` une fois ' +
  'supprimée, `mine` si le lecteur l’a écrite) et les interventions de la structure — statuts de ' +
  'financement donnés (`financing_status`), lignes du plan écrites (`funding_plan`), éligibilités ' +
  'déclarées, modifiées, vérifiées ou retirées (`eligibility`), étapes validées ou rouvertes ' +
  '(`support_step`) —, chacune datée avec son auteur. Les actions de l’entreprise n’y figurent pas.'

const WRITE =
  ' Seul l’auteur d’une note la modifie ou la supprime (`403` sinon), depuis la `version` lue : une ' +
  'note modifiée ou supprimée entre-temps est refusée (`409`), jamais écrasée. Renvoie le journal à ' +
  'jour.' +
  INTERNAL

// ROADMAP E06.08: the workspace's side of a candidature it received — its active conseillers (the
// right to manage it is not required) and Confluent administrators, on a sent candidature. The
// workspace is checked before anything else (guard, `404` outside it), then the candidatures' read
// rule (`403` for an investisseur). The owner of the request has no route here.
@ApiTags('Candidatures reçues')
@ApiBearerAuth('jwt')
@ApiParam({ name: 'workspaceId', description: 'UUID du workspace' })
@ApiParam({ name: 'candidatureId', description: 'UUID de la candidature' })
@ApiUnauthorizedResponse({ description: 'JWT manquant.' })
@ApiForbiddenResponse({
  description:
    'Membre du workspace qui n’en est pas conseiller ; note d’un autre auteur (modification, suppression).',
})
@ApiNotFoundResponse({
  description:
    'Workspace inexistant ou dont le compte n’est pas membre actif (même réponse) ; candidature ' +
    'inexistante, d’un autre workspace ou encore en brouillon ; note inconnue sur cette candidature.',
})
@UseGuards(WorkspaceAccessGuard)
@Controller('workspaces/:workspaceId/candidatures/:candidatureId')
export class InterventionsController {
  constructor(
    private readonly journal: InterventionJournalService,
    private readonly notes: CandidatureNotesService,
  ) {}

  @Get('interventions')
  @ApiOperation({
    summary: 'Journal des interventions et notes internes (structure)',
    description: JOURNAL + INTERNAL,
  })
  @ApiOkResponse({ description: 'Journal.' })
  get(
    @Param('workspaceId', uuid) workspaceId: string,
    @Param('candidatureId', uuid) candidatureId: string,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<InterventionJournalView> {
    return this.journal.get(user, workspaceId, candidatureId)
  }

  @Post('notes')
  @ApiOperation({
    summary: 'Écrire une note interne (structure)',
    description:
      '`{ body }` : texte simple par paragraphes, 4 000 caractères au plus, sans balise HTML ; ' +
      '500 notes au plus par candidature (`409`). Journalisé sans le texte ' +
      '(`candidature_note_updated`).' +
      WRITE,
  })
  @ApiCreatedResponse({ description: 'Journal à jour.' })
  @ApiBadRequestResponse({ description: 'Texte vide, trop long ou balisé.' })
  @ApiConflictResponse({ description: 'Limite de notes atteinte.' })
  create(
    @Param('workspaceId', uuid) workspaceId: string,
    @Param('candidatureId', uuid) candidatureId: string,
    @Body() body: CreateCandidatureNoteDto,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<InterventionJournalView> {
    return this.notes.create(user, workspaceId, candidatureId, body)
  }

  @Patch('notes/:noteId')
  @ApiParam({ name: 'noteId', description: 'UUID de la note' })
  @ApiOperation({
    summary: 'Réécrire une note interne (son auteur)',
    description:
      '`{ body, version }` : le nouveau texte, datée « modifiée » ; le même texte ne change rien.' +
      WRITE,
  })
  @ApiOkResponse({ description: 'Journal à jour.' })
  @ApiBadRequestResponse({ description: 'Texte vide, trop long ou balisé.' })
  @ApiConflictResponse({ description: 'Note modifiée ou supprimée entre-temps.' })
  edit(
    @Param('workspaceId', uuid) workspaceId: string,
    @Param('candidatureId', uuid) candidatureId: string,
    @Param('noteId', uuid) noteId: string,
    @Body() body: UpdateCandidatureNoteDto,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<InterventionJournalView> {
    return this.notes.edit(user, workspaceId, candidatureId, noteId, body)
  }

  @Delete('notes/:noteId')
  @ApiParam({ name: 'noteId', description: 'UUID de la note' })
  @ApiOperation({
    summary: 'Supprimer une note interne (son auteur)',
    description:
      '`?version=` : la version de la note lue. Son texte est effacé ; le journal garde la trace ' +
      '« note supprimée », datée avec son auteur.' +
      WRITE,
  })
  @ApiOkResponse({ description: 'Journal à jour.' })
  @ApiConflictResponse({ description: 'Note modifiée ou supprimée entre-temps.' })
  remove(
    @Param('workspaceId', uuid) workspaceId: string,
    @Param('candidatureId', uuid) candidatureId: string,
    @Param('noteId', uuid) noteId: string,
    @Query() query: DeleteCandidatureNoteQueryDto,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<InterventionJournalView> {
    return this.notes.remove(user, workspaceId, candidatureId, noteId, query.version)
  }
}
