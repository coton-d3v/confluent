import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Post,
  UseGuards,
} from '@nestjs/common'
import {
  ApiBadRequestResponse,
  ApiBearerAuth,
  ApiConflictResponse,
  ApiCreatedResponse,
  ApiForbiddenResponse,
  ApiGoneResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger'
import { inviteCompanyOwnerSchema, prepareCompanySchema } from '@confluent/shared'
import { createZodDto } from 'nestjs-zod'
import { CurrentUser } from '../../common/decorators/current-user.decorator'
import type { AuthenticatedUser } from '../auth/strategies/jwt.strategy'
import { WorkspaceAccessGuard } from '../workspaces/workspace-access.guard'
import {
  CompanyTransfersService,
  type CompanyTransferOfferView,
  type PreparedCompanyView,
} from './company-transfers.service'

class PrepareCompanyDto extends createZodDto(prepareCompanySchema) {}
class InviteCompanyOwnerDto extends createZodDto(inviteCompanyOwnerSchema) {}

const uuid = new ParseUUIDPipe()

// Companies a workspace's conseillers prepare for entrepreneurs (ROADMAP E05.08). The workspace is
// checked before the body (guard, 404 outside it), then the service applies the finer rule: its
// active conseillers (403 for an investisseur).
@ApiTags('Entreprises préparées')
@ApiBearerAuth('jwt')
@ApiUnauthorizedResponse({ description: 'JWT manquant.' })
@ApiNotFoundResponse({
  description:
    'Workspace inexistant ou dont le compte n’est pas membre actif (même réponse) ; entreprise ' +
    'inconnue, préparée ailleurs, reprise par son entrepreneur ou tenue par un autre conseiller.',
})
@ApiForbiddenResponse({ description: 'Membre du workspace qui n’en est pas conseiller.' })
@UseGuards(WorkspaceAccessGuard)
@Controller('workspaces/:workspaceId/prepared-companies')
export class PreparedCompaniesController {
  constructor(private readonly transfers: CompanyTransfersService) {}

  @Get()
  @ApiOperation({
    summary: 'Entreprises préparées dans le workspace',
    description:
      'Les entreprises préparées par les conseillers du workspace, la plus récente invitation ' +
      'd’abord : celles encore tenues par un conseiller (`held`, `holder`, nombre de demandes) et ' +
      'celles reprises par leur entrepreneur (`invitation.status` `accepted`, sans autre détail). ' +
      'Seul le conseiller qui la tient (`heldByMe`) ouvre et modifie une entreprise.',
  })
  @ApiOkResponse({ description: 'Entreprises préparées.' })
  list(
    @Param('workspaceId', uuid) workspaceId: string,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<PreparedCompanyView[]> {
    return this.transfers.listPrepared(user, workspaceId)
  }

  @Post()
  @ApiOperation({
    summary: 'Préparer une entreprise pour un entrepreneur',
    description:
      'Crée l’entreprise et sa première demande de financement (du même nom), tenues par le ' +
      'conseiller connecté — il en complète le profil, la bibliothèque et les demandes depuis les ' +
      'écrans habituels, sans pouvoir les partager ni les publier — et invite l’entrepreneur ' +
      '(`ownerEmail`) à en devenir propriétaire : compte créé (porteur de projet) si l’adresse est ' +
      `inconnue, email dans tous les cas ; la réponse ne dit pas si le compte existait. ` +
      'Invitation valable 30 jours.',
  })
  @ApiCreatedResponse({ description: 'Entreprise préparée et invitation envoyée.' })
  @ApiBadRequestResponse({ description: 'Nom ou adresse invalide, ou adresse du conseiller.' })
  prepare(
    @Param('workspaceId', uuid) workspaceId: string,
    @Body() body: PrepareCompanyDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.transfers.prepare(user, workspaceId, body)
  }

  @Post(':companyId/invitation')
  @ApiOperation({
    summary: 'Inviter de nouveau',
    description:
      'Nouvelle invitation pour une entreprise que le conseiller connecté tient : à une autre ' +
      'adresse, ou de nouveau après un refus ou une expiration. Elle remplace celle qui attendait ' +
      'une réponse (retirée, ou expirée si sa validité est passée).',
  })
  @ApiCreatedResponse({ description: 'Invitation envoyée.' })
  @ApiBadRequestResponse({ description: 'Adresse invalide, ou adresse du conseiller.' })
  invite(
    @Param('workspaceId', uuid) workspaceId: string,
    @Param('companyId', uuid) companyId: string,
    @Body() body: InviteCompanyOwnerDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.transfers.invite(user, workspaceId, companyId, body)
  }

  @Delete(':companyId/invitation')
  @ApiOperation({
    summary: 'Retirer l’invitation',
    description:
      'Retire l’invitation qui attend une réponse, s’il y en a une ; l’entreprise reste au ' +
      'conseiller. Sans invitation en attente, ne change rien.',
  })
  @ApiOkResponse({ description: 'Entreprise préparée, invitation retirée.' })
  cancel(
    @Param('workspaceId', uuid) workspaceId: string,
    @Param('companyId', uuid) companyId: string,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<PreparedCompanyView> {
    return this.transfers.cancel(user, workspaceId, companyId)
  }
}

// The companies offered to the signed-in person, and their answer (ROADMAP E05.08). Only the
// account an invitation is addressed to sees it and answers it.
@ApiTags('Entreprises préparées')
@ApiBearerAuth('jwt')
@ApiUnauthorizedResponse({ description: 'JWT manquant.' })
@Controller('company-transfers')
export class CompanyTransfersController {
  constructor(private readonly transfers: CompanyTransfersService) {}

  @Get()
  @ApiOperation({
    summary: 'Entreprises qui me sont proposées',
    description:
      'Les propositions adressées au compte connecté qui attendent sa réponse : nom de ' +
      'l’entreprise, nombre de demandes, workspace et conseiller qui l’a préparée, échéance. ' +
      'Rien du contenu de l’entreprise avant acceptation.',
  })
  @ApiOkResponse({ description: 'Propositions en attente.' })
  list(@CurrentUser() user: AuthenticatedUser): Promise<CompanyTransferOfferView[]> {
    return this.transfers.listOffers(user)
  }

  @Post(':transferId/accept')
  @HttpCode(200)
  @ApiOperation({
    summary: 'Accepter une proposition',
    description:
      'Le compte connecté devient propriétaire de l’entreprise, de toutes ses demandes, de son ' +
      'profil et de sa bibliothèque, en une opération ; le conseiller n’y a plus accès. Ses autres ' +
      'entreprises ne changent pas. Accepter de nouveau ne change rien. Réservé aux comptes qui ' +
      'peuvent posséder une entreprise (porteur de projet, administrateur).',
  })
  @ApiOkResponse({ description: '`{ status: "accepted", companyId }`.' })
  @ApiForbiddenResponse({ description: 'Compte qui ne peut pas posséder d’entreprise.' })
  @ApiNotFoundResponse({ description: 'Proposition inconnue ou adressée à un autre compte.' })
  @ApiConflictResponse({ description: 'Proposition déjà refusée.' })
  @ApiGoneResponse({ description: 'Proposition expirée, retirée ou remplacée.' })
  accept(@Param('transferId', uuid) transferId: string, @CurrentUser() user: AuthenticatedUser) {
    return this.transfers.decide(user, transferId, 'accepted')
  }

  @Post(':transferId/decline')
  @HttpCode(200)
  @ApiOperation({
    summary: 'Refuser une proposition',
    description:
      'Rien n’est rattaché au compte connecté ; l’entreprise reste au conseiller, qui peut inviter ' +
      'une autre adresse ou la supprimer. Refuser de nouveau ne change rien.',
  })
  @ApiOkResponse({ description: '`{ status: "declined", companyId: null }`.' })
  @ApiNotFoundResponse({ description: 'Proposition inconnue ou adressée à un autre compte.' })
  @ApiConflictResponse({ description: 'Proposition déjà acceptée.' })
  @ApiGoneResponse({ description: 'Proposition expirée, retirée ou remplacée.' })
  decline(@Param('transferId', uuid) transferId: string, @CurrentUser() user: AuthenticatedUser) {
    return this.transfers.decide(user, transferId, 'declined')
  }
}
