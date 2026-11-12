import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Put,
  UseGuards,
} from '@nestjs/common'
import {
  ApiBadRequestResponse,
  ApiBearerAuth,
  ApiConflictResponse,
  ApiForbiddenResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiParam,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger'
import { SHOWCASE_CARD_LIMITS, setShowcaseCardSchema } from '@confluent/shared'
import { createZodDto } from 'nestjs-zod'
import { CurrentUser } from '../../common/decorators/current-user.decorator'
import type { AuthenticatedUser } from '../auth/strategies/jwt.strategy'
import { WorkspaceAccessGuard } from '../workspaces/workspace-access.guard'
import type { ManagedShowcaseCardView } from './showcase-cards'
import {
  ShowcaseCardsService,
  type OwnerShowcaseCardView,
  type ReceivedShowcaseCardView,
} from './showcase-cards.service'

class SetShowcaseCardDto extends createZodDto(setShowcaseCardSchema) {}

const uuid = new ParseUUIDPipe()

// What a card shows, said once for every route.
const CARD_SCOPE =
  'La carte, sur la page publique du workspace (`/w/<slug>`, une fois publiée), montre à tous : le ' +
  'pseudonyme, le secteur (classification lisible au niveau `public`), la région choisie, le ' +
  'montant recherché, le plan de financement de cette candidature en agrégats (obtenu, en cours, ' +
  'reste à financer) et « Prochain comité » (nom et heure de la session qui a retenu la demande) ou ' +
  '« En attente de comité ». Jamais le titre de la demande, sa présentation, ses réponses ou ' +
  'documents, le nom de l’entreprise, une coordonnée, les sources du plan, une promesse, un ' +
  'investisseur ni une note. Consentement propre à cette candidature, distinct du vivier et des ' +
  'partages (un partage `public` n’est jamais une carte).'

// ROADMAP E09.02: the owner of a financing request consents to show its anonymous card on the public
// page of a workspace it is presented to, and withdraws it. The candidature names the workspace;
// `404` alike for another account's candidature (a conseiller's or an administrator's included) and
// an unknown one.
@ApiTags('Candidatures')
@ApiBearerAuth('jwt')
@ApiUnauthorizedResponse({ description: 'JWT manquant.' })
@ApiParam({ name: 'candidatureId', description: 'UUID de la candidature' })
@ApiNotFoundResponse({ description: 'Candidature inexistante ou d’un autre compte.' })
@Controller('candidatures/:candidatureId/showcase-card')
export class ShowcaseCardsController {
  constructor(private readonly cards: ShowcaseCardsService) {}

  @Get()
  @ApiOperation({
    summary: 'Carte de la demande sur la page publique de la structure',
    description:
      '`card` (`null` sans consentement) : pseudonyme, région, état (`shown`, `paused` avec sa ' +
      'raison, `withdrawn`), dates ; `version` à renvoyer avec un changement ; `blocker` : ce qui ' +
      'empêche de consentir maintenant ; `pagePublished` ; `preview` : la carte telle que le public ' +
      'la lirait, construite par la même projection. ' +
      CARD_SCOPE,
  })
  @ApiOkResponse({ description: 'Carte, état et aperçu.' })
  get(
    @Param('candidatureId', uuid) candidatureId: string,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<OwnerShowcaseCardView> {
    return this.cards.forOwner(candidatureId, user.id)
  }

  @Put()
  @ApiOperation({
    summary: 'Afficher la carte sur la page publique de la structure',
    description:
      'Consentement explicite du porteur de projet (`consent: true`) sous le pseudonyme qu’il ' +
      `choisit (\`pseudonym\`, obligatoire, ${SHOWCASE_CARD_LIMITS.pseudonym.min} à ` +
      `${SHOWCASE_CARD_LIMITS.pseudonym.max} caractères, une ligne sans balise, adresse ni lien ; ` +
      'jamais le nom de l’entreprise, le titre de la demande ni le nom du porteur, `400`), avec une ' +
      'région (`region`, liste fermée) ou aucune (`null`), depuis la `version` lue (`null` sans ' +
      'carte ; `409` sinon, `details.currentVersion`). Exige la candidature envoyée, la demande ' +
      'publiée (ni brouillon ni archivée) et son suivi non clos dans ce workspace (`409`, comme le ' +
      'vivier). Daté et journalisé (`showcase_card_published`). Mêmes valeurs : rien ne ' +
      'change. La carte est en pause tant que la page n’est pas publiée, que la demande ne l’est ' +
      'plus ou que le suivi est clos ; archiver la demande la retire. ' +
      CARD_SCOPE,
  })
  @ApiOkResponse({ description: 'Carte, état et aperçu.' })
  @ApiBadRequestResponse({
    description: 'Pseudonyme absent, invalide ou réel ; région inconnue ; consentement absent.',
  })
  @ApiConflictResponse({
    description:
      'Carte modifiée entre-temps, candidature non envoyée, demande non publiée ou archivée, suivi ' +
      'clos, ou entreprise en préparation par un conseiller.',
  })
  publish(
    @Param('candidatureId', uuid) candidatureId: string,
    @Body() body: SetShowcaseCardDto,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<OwnerShowcaseCardView> {
    return this.cards.publish(candidatureId, user.id, body)
  }

  @Delete()
  @HttpCode(200)
  @ApiOperation({
    summary: 'Retirer la carte de la page publique de la structure',
    description:
      'Retire la carte de ce seul workspace, absente dès la lecture publique suivante ; journalisé ' +
      '(`showcase_card_withdrawn`). Rien ne change pour une carte déjà retirée ou jamais consentie. ' +
      'Toujours possible, même masquée par la structure.',
  })
  @ApiOkResponse({ description: 'Carte, état et aperçu.' })
  withdraw(
    @Param('candidatureId', uuid) candidatureId: string,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<OwnerShowcaseCardView> {
    return this.cards.withdraw(candidatureId, user.id)
  }
}

// Where a received candidature's card stands, for the workspace's conseillers (read-only).
@ApiTags('Candidatures reçues')
@ApiBearerAuth('jwt')
@ApiUnauthorizedResponse({ description: 'JWT manquant.' })
@ApiParam({ name: 'workspaceId', description: 'UUID du workspace' })
@ApiParam({ name: 'candidatureId', description: 'UUID de la candidature' })
@ApiForbiddenResponse({ description: 'Membre du workspace qui n’en est pas conseiller.' })
@ApiNotFoundResponse({
  description:
    'Workspace inexistant ou dont le compte n’est pas membre actif (même réponse) ; candidature ' +
    'inexistante, d’un autre workspace ou encore en brouillon.',
})
@UseGuards(WorkspaceAccessGuard)
@Controller('workspaces/:workspaceId/candidatures/:candidatureId/showcase-card')
export class ReceivedShowcaseCardController {
  constructor(private readonly cards: ShowcaseCardsService) {}

  @Get()
  @ApiOperation({
    summary: 'Carte de la candidature sur la page publique (structure)',
    description:
      'Lecture seule : `card` (`null` sans consentement du porteur) — pseudonyme, région, état, ' +
      'dates — et `pagePublished`. Seul le porteur consent ou retire ; les gestionnaires masquent ' +
      'ou rétablissent depuis `…/admin/workspaces/:id/public-page/cards`. ' +
      CARD_SCOPE,
  })
  @ApiOkResponse({ description: 'Carte et état.' })
  get(
    @Param('workspaceId', uuid) workspaceId: string,
    @Param('candidatureId', uuid) candidatureId: string,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<ReceivedShowcaseCardView> {
    return this.cards.forWorkspace(user, workspaceId, candidatureId)
  }
}

// ROADMAP E09.03: the cards of the workspace's public page, for its managers, who may hide one from
// it — never change it — and restore it.
@ApiTags('Admin · Workspaces')
@ApiBearerAuth('jwt')
@ApiUnauthorizedResponse({ description: 'JWT manquant.' })
@ApiParam({ name: 'workspaceId', description: 'UUID du workspace' })
@ApiForbiddenResponse({ description: 'Membre du workspace sans le droit de le gérer.' })
@ApiNotFoundResponse({
  description: 'Workspace inexistant ou dont le compte n’est pas membre actif (même réponse).',
})
@UseGuards(WorkspaceAccessGuard)
@Controller('admin/workspaces/:workspaceId/public-page/cards')
export class ShowcaseCardModerationController {
  constructor(private readonly cards: ShowcaseCardsService) {}

  @Get()
  @ApiOperation({
    summary: 'Cartes de la page publique (gestionnaires)',
    description:
      'Chaque carte consentie et non retirée par son porteur, affichée, en pause ou masquée, de la ' +
      'plus récente à la plus ancienne : `candidatureId` (pour ouvrir la candidature reçue), ' +
      'pseudonyme, région, état et raison de la pause, date du consentement, `hiddenAt` (masquée ' +
      'par la structure depuis, ou `null`). Gestionnaires et administrateurs.',
  })
  @ApiOkResponse({ description: 'Cartes.' })
  list(
    @Param('workspaceId', uuid) workspaceId: string,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<ManagedShowcaseCardView[]> {
    return this.cards.listForManagers(user, workspaceId)
  }

  @Put(':candidatureId/hidden')
  @ApiParam({ name: 'candidatureId', description: 'UUID de la candidature' })
  @ApiOperation({
    summary: 'Masquer une carte de la page publique',
    description:
      'La carte disparaît de la page publique dès la lecture suivante, sans rien changer d’autre : ' +
      'pseudonyme, région et consentement restent ceux du porteur, qui lit « Masquée par la ' +
      'structure » et peut toujours la retirer. Elle reste masquée si le porteur change de ' +
      'pseudonyme ou consent à nouveau, jusqu’à ce qu’un gestionnaire la rétablisse. Déjà ' +
      'masquée : rien ne change. Journal `showcase_card_hidden`.',
  })
  @ApiOkResponse({ description: 'Carte masquée.' })
  @ApiNotFoundResponse({
    description: 'Aucune carte consentie et non retirée pour cette candidature du workspace.',
  })
  hide(
    @Param('workspaceId', uuid) workspaceId: string,
    @Param('candidatureId', uuid) candidatureId: string,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<ManagedShowcaseCardView> {
    return this.cards.setHidden(user, workspaceId, candidatureId, true)
  }

  @Delete(':candidatureId/hidden')
  @HttpCode(200)
  @ApiParam({ name: 'candidatureId', description: 'UUID de la candidature' })
  @ApiOperation({
    summary: 'Rétablir une carte masquée',
    description:
      'La carte reprend sa place sur la page publique si rien d’autre ne la met en pause. Non ' +
      'masquée : rien ne change. Journal `showcase_card_unhidden`.',
  })
  @ApiOkResponse({ description: 'Carte rétablie.' })
  @ApiNotFoundResponse({
    description: 'Aucune carte consentie et non retirée pour cette candidature du workspace.',
  })
  unhide(
    @Param('workspaceId', uuid) workspaceId: string,
    @Param('candidatureId', uuid) candidatureId: string,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<ManagedShowcaseCardView> {
    return this.cards.setHidden(user, workspaceId, candidatureId, false)
  }
}
