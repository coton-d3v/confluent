import { Controller, Delete, Get, HttpCode, Param, ParseUUIDPipe, UseGuards } from '@nestjs/common'
import {
  ApiBearerAuth,
  ApiForbiddenResponse,
  ApiNoContentResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiParam,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger'
import { CurrentUser } from '../../common/decorators/current-user.decorator'
import type { AuthenticatedUser } from '../auth/strategies/jwt.strategy'
import { WorkspaceAccessGuard } from '../workspaces/workspace-access.guard'
import { DISCLOSURE_SCOPE, INTEREST_SCOPE, PLEDGE_SCOPE } from './opportunities.controller'
import {
  PositionsService,
  type DossierPositionsView,
  type MyPositionsView,
  type WorkspacePositionsView,
} from './positions.service'

const uuid = new ParseUUIDPipe()

// ROADMAP E07.07: « Mes positionnements » — the signed-in investor's own positions, from their account
// only — and the withdrawal of a consent given to a structure.
@ApiTags('Opportunités')
@ApiBearerAuth('jwt')
@ApiUnauthorizedResponse({ description: 'JWT manquant.' })
@Controller('positions')
export class PositionsController {
  constructor(private readonly positions: PositionsService) {}

  @Get()
  @ApiOperation({
    summary: 'Mes positionnements',
    description:
      'Les marques d’intérêt, promesses et consentements donnés à des structures du compte ' +
      'connecté, une ligne par demande, l’activité la plus récente d’abord : `readable` (la demande ' +
      'est lue maintenant comme opportunité : le positionnement compte pour le porteur, et pour une ' +
      'structure qui a son consentement), `closed` (archivée par son porteur : promesse close), ' +
      '`dossier` et `accessLevel` (la partie de la liste des opportunités, au niveau de lecture ; ' +
      '`null` pour une demande que le compte ne lit plus — rien d’autre n’en est dit), `interest`, ' +
      '`pledge` (commentaire compris, pour le compte seul) et `disclosures`. Jamais les ' +
      'positionnements d’un autre compte. Ne compte pas comme une lecture des opportunités.',
  })
  @ApiOkResponse({ description: 'Positionnements du compte.' })
  mine(@CurrentUser() user: AuthenticatedUser): Promise<MyPositionsView> {
    return this.positions.mine(user)
  }

  @Delete('disclosures/:disclosureId')
  @HttpCode(204)
  @ApiOperation({
    summary: 'Ne plus montrer mon positionnement à une structure',
    description:
      DISCLOSURE_SCOPE +
      '\n\nRetire un consentement du compte connecté par son identifiant, qu’il lise encore la ' +
      'demande ou soit encore membre de la structure ou non ; même réponse pour un consentement ' +
      'déjà retiré, d’un autre compte ou inconnu. Journalisé ' +
      '(`investor_position_disclosure_withdrawn`, invisible du porteur).',
  })
  @ApiParam({ name: 'disclosureId', description: 'UUID du consentement' })
  @ApiNoContentResponse({ description: 'Ce consentement n’existe plus.' })
  withdrawDisclosure(
    @Param('disclosureId', uuid) disclosureId: string,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<void> {
    return this.positions.withdrawDisclosure(user, disclosureId)
  }
}

// ROADMAP E07.07: what the owner of a request reads of the investors' positions, in one view.
@ApiTags('Opportunités')
@ApiBearerAuth('jwt')
@ApiUnauthorizedResponse({ description: 'JWT manquant.' })
@Controller('dossiers/:dossierId/positions')
export class DossierPositionsController {
  constructor(private readonly positions: PositionsService) {}

  @Get()
  @ApiOperation({
    summary: '[Entrepreneur] Positionnements des investisseurs sur une demande',
    description:
      INTEREST_SCOPE +
      '\n\n' +
      PLEDGE_SCOPE +
      '\n\nRéservé au porteur de la demande : ce que `GET …/interests` et `GET …/pledges` lui ' +
      'ouvrent, en une vue. `interests.count`, `pledges.count` et `pledges.totalEur` : investisseurs ' +
      'qui lisent la demande ; `named` : par nom, chaque investisseur qui montre son nom, avec sa ' +
      'marque d’intérêt si elle montre son nom (`markedAt`) et sa promesse si elle montre son nom ' +
      '(`amountEur`, `null` s’il ne montre pas son montant) — une marque et une promesse ne sont ' +
      'réunies que si les deux montrent le nom ; `anonymousAmounts` : montants des promesses qui ' +
      'montrent leur montant sans le nom, les plus gros d’abord. Jamais l’intention, le commentaire ' +
      'ni l’adresse.',
  })
  @ApiParam({ name: 'dossierId', description: 'UUID de la demande' })
  @ApiOkResponse({ description: 'Nombres, total et ce que chaque investisseur montre.' })
  @ApiNotFoundResponse({
    description: 'Demande inexistante ou dont le compte n’est pas le porteur.',
  })
  forOwner(
    @Param('dossierId', uuid) dossierId: string,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<DossierPositionsView> {
    return this.positions.forOwner(dossierId, user.id)
  }
}

// ROADMAP E07.07: a structure's follow-up of the positions its investors consented to show it, for
// its conseillers and Confluent's administrators. The workspace is checked first (guard, `404`
// outside it), then the candidatures' read rule (`403` for an investisseur).
@ApiTags('Candidatures reçues')
@ApiBearerAuth('jwt')
@ApiParam({ name: 'workspaceId', description: 'UUID du workspace' })
@ApiUnauthorizedResponse({ description: 'JWT manquant.' })
@ApiForbiddenResponse({ description: 'Membre du workspace qui n’en est pas conseiller.' })
@ApiNotFoundResponse({
  description: 'Workspace inexistant ou dont le compte n’est pas membre actif (même réponse).',
})
@UseGuards(WorkspaceAccessGuard)
@Controller('workspaces/:workspaceId/positions')
export class WorkspacePositionsController {
  constructor(private readonly positions: PositionsService) {}

  @Get()
  @ApiOperation({
    summary: 'Suivi des positionnements des investisseurs',
    description:
      DISCLOSURE_SCOPE +
      '\n\nChaque demande listée maintenant dans le vivier du workspace (candidature envoyée, ' +
      'publication ni retirée ni en pause), par nom, avec les investisseurs qui ont choisi de ' +
      'montrer leur positionnement à la structure et la lisent encore par son vivier : `identity` ' +
      '(nom du compte, organisation dans le workspace), `disclosedAt`, `interest` (`markedAt`) ou ' +
      '`null`, `pledge` (`intention`, `amountEur`, `updatedAt`) ou `null` ; `pledgedEur` : total ' +
      'de leurs promesses. Rien des autres investisseurs, pas même un nombre.',
  })
  @ApiOkResponse({ description: 'Demandes du vivier et positionnements montrés.' })
  forWorkspace(
    @Param('workspaceId', uuid) workspaceId: string,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<WorkspacePositionsView> {
    return this.positions.forWorkspace(user, workspaceId)
  }
}
