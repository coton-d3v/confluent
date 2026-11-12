import { Body, Controller, Delete, Get, HttpCode, Param, Patch, Post, Req } from '@nestjs/common'
import {
  ApiBearerAuth,
  ApiConflictResponse,
  ApiCreatedResponse,
  ApiForbiddenResponse,
  ApiNoContentResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiUnprocessableEntityResponse,
  ApiOperation,
  ApiParam,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger'
import type { Request } from 'express'
import type { Dossier } from '@prisma/client'
import {
  createCompanyDossierSchema,
  createDossierSchema,
  updateDossierSchema,
} from '@confluent/shared'
import { createZodDto } from 'nestjs-zod'
import { DossiersService } from './dossiers.service'
import { SITE_ORIGIN } from '../audit/action-origin'
import type { AuthenticatedUser } from '../auth/strategies/jwt.strategy'

class CreateDossierDto extends createZodDto(createDossierSchema) {}
class CreateCompanyDossierDto extends createZodDto(createCompanyDossierSchema) {}
class UpdateDossierDto extends createZodDto(updateDossierSchema) {}

function currentUser(req: Request): AuthenticatedUser {
  return (req as Request & { user: AuthenticatedUser }).user
}

@ApiTags('Dossiers')
@ApiBearerAuth('jwt')
@ApiUnauthorizedResponse({ description: 'JWT manquant, invalide, ou user désactivé.' })
@Controller('dossiers')
export class DossiersController {
  constructor(private readonly service: DossiersService) {}

  @Post()
  @HttpCode(201)
  @ApiOperation({
    summary: 'Créer un dossier',
    description:
      'Crée un dossier possédé par l’user JWT, avec son entreprise (E05.04) : une entreprise du même ' +
      'nom, possédée par le même compte (`companyId`, `company`). Réservé aux porteurs de projet ' +
      '(entrepreneur) et aux administrateurs. Un slug URL-safe est dérivé du `name` (collision-free). ' +
      'Le dossier est automatiquement lié à la version active du questionnaire (snapshot immuable — FR14).',
  })
  @ApiCreatedResponse({ description: 'Dossier créé avec son entreprise.' })
  @ApiForbiddenResponse({
    description: 'Compte qui ne peut pas posséder d’entreprise (financeur).',
  })
  create(@Req() req: Request, @Body() body: CreateDossierDto) {
    return this.service.create({ owner: currentUser(req), name: body.name })
  }

  @Get()
  @ApiOperation({
    summary: 'Lister mes dossiers',
    description:
      'Retourne uniquement les dossiers possédés par l’user JWT, triés par date de création desc, avec ' +
      'leur entreprise (`company`). Jamais les dossiers des autres — même pas en cas de bug : le filtre ' +
      '`userId` est appliqué systématiquement. Un financeur reçoit aussi les dossiers partagés avec ' +
      'lui, sans leur entreprise. E05.08 : un conseiller reçoit ceux des entreprises qu’il prépare ' +
      'pour un entrepreneur (`company.inPreparation`), tant qu’il est conseiller actif du workspace.',
  })
  @ApiOkResponse({ description: 'Liste des dossiers de l’user.' })
  list(@Req() req: Request): Promise<Dossier[]> {
    return this.service.listForUser(currentUser(req))
  }

  @Get('by-slug/:slug')
  @ApiOperation({
    summary: 'Détail d’un dossier par l’adresse de sa page (E10.08)',
    description:
      'Même réponse et mêmes droits que `GET /v1/dossiers/:id`, le dossier étant désigné par son ' +
      '`slug` : la page d’un dossier n’a plus à lire la liste entière des dossiers du compte pour ' +
      'le trouver. `404` identique pour un slug inconnu et pour un dossier que le compte ne lit pas.',
  })
  @ApiParam({ name: 'slug', description: 'Slug du dossier (adresse de sa page)' })
  @ApiOkResponse({ description: 'Dossier + snapshot de la version questionnaire.' })
  @ApiNotFoundResponse({ description: 'Slug inconnu, ou dossier que le compte ne lit pas.' })
  getBySlug(@Req() req: Request, @Param('slug') slug: string) {
    return this.service.getBySlugWithQuestionnaire(slug, currentUser(req))
  }

  @Get(':id')
  @ApiOperation({
    summary: 'Détail d’un dossier',
    description:
      'Retourne le dossier + sa version de questionnaire snapshot (structure des champs utilisée au moment ' +
      'de la création). Renvoie `404` si le dossier n’existe pas ou appartient à un autre user — ' +
      'pas de `403` pour éviter de confirmer l’existence. Destinataire d’un partage nominatif ' +
      'actif (financeur) : au niveau le plus large de ses partages, les questions, les sections ' +
      'qui en contiennent, la classification et la présentation de `GET /v1/shares/:token`, rien ' +
      'd’autre que les identifiants et dates techniques de la demande (E07.04).',
  })
  @ApiParam({ name: 'id', description: 'UUID du dossier' })
  @ApiOkResponse({ description: 'Dossier + snapshot de la version questionnaire.' })
  @ApiNotFoundResponse({ description: 'Dossier inexistant ou possédé par un autre user.' })
  getOne(@Req() req: Request, @Param('id') id: string) {
    return this.service.getWithQuestionnaire(id, currentUser(req))
  }

  @Patch(':id')
  @ApiOperation({
    summary: 'Modifier le titre et la présentation d’une demande',
    description:
      'Titre (`name`, régénère le `slug` sans collision) et présentation de la demande de financement ' +
      '(E05.07) : `summary` (≤ 300), `objective` (≤ 1000), `description` (≤ 5000) — textes simples, ' +
      'balises HTML refusées, vide ou `null` pour effacer —, `amountEur` (euros entiers, 1 à 1 milliard, ' +
      '`null` pour effacer) et `financingTypes` (liste fermée, sans doublon). Champ omis : inchangé ; ' +
      'champ inconnu : `400`. Une demande publiée garde ce que la publication exige (sinon `422` ' +
      '`DOSSIER_NOT_PUBLISHABLE`). Seul le propriétaire peut éditer, `404` sinon.',
  })
  @ApiOkResponse({ description: 'Dossier mis à jour.' })
  @ApiUnprocessableEntityResponse({
    description: 'Demande publiée : présentation incomplète refusée (la dépublier d’abord).',
  })
  @ApiConflictResponse({ description: 'Demande archivée (la désarchiver d’abord).' })
  @ApiNotFoundResponse({ description: 'Dossier inexistant ou possédé par un autre user.' })
  update(
    @Req() req: Request,
    @Param('id') id: string,
    @Body() body: UpdateDossierDto,
  ): Promise<Dossier> {
    return this.service.update({ userId: currentUser(req).id, id, changes: body })
  }

  @Post(':id/publish')
  @HttpCode(200)
  @ApiOperation({
    summary: 'Publier une demande de financement (E05.07)',
    description:
      'Le propriétaire déclare la demande prête : `publicationStatus` = `published`, `publishedAt`. ' +
      'Exige le résumé, l’objectif, le montant, au moins un type de financement et le profil de ' +
      'l’entreprise soumis pour ce dossier (sinon `422` `DOSSIER_NOT_PUBLISHABLE`, `error.details` ' +
      'liste ce qui manque). Distincte de la soumission (contrôle du profil et classification). ' +
      'Les destinataires des partages voient alors la présentation de la demande ; la publication ' +
      'n’ouvre ni ne ferme aucun partage, et ne publie la demande dans aucun vivier (E07.02 : ' +
      'consentement propre à chaque structure ; celles en pause reprennent). Publier une demande ' +
      'déjà publiée ne change rien ; une demande archivée doit d’abord être désarchivée (`409` ' +
      '`DOSSIER_ARCHIVED`). Journalisé.',
  })
  @ApiOkResponse({ description: 'Demande publiée.' })
  @ApiUnprocessableEntityResponse({ description: 'Informations manquantes pour publier.' })
  @ApiConflictResponse({
    description: 'Demande archivée, ou entreprise en préparation par un conseiller.',
  })
  @ApiNotFoundResponse({ description: 'Dossier inexistant ou possédé par un autre user.' })
  publish(@Req() req: Request, @Param('id') id: string): Promise<Dossier> {
    return this.service.publish(id, currentUser(req).id)
  }

  @Post(':id/unpublish')
  @HttpCode(200)
  @ApiOperation({
    summary: 'Dépublier une demande (E05.07)',
    description:
      'Retour au brouillon : les partages restent ouverts mais ne montrent plus la présentation de la ' +
      'demande. Ses publications dans les viviers des structures sont en pause jusqu’à sa nouvelle ' +
      'publication (E07.02). Sans effet sur un brouillon ; `409` sur une demande archivée. ' +
      'Propriétaire seul (`404` sinon). Journalisé.',
  })
  @ApiOkResponse({ description: 'Demande en brouillon.' })
  @ApiConflictResponse({ description: 'Demande archivée.' })
  @ApiNotFoundResponse({ description: 'Dossier inexistant ou possédé par un autre user.' })
  unpublish(@Req() req: Request, @Param('id') id: string): Promise<Dossier> {
    return this.service.unpublish(id, currentUser(req).id)
  }

  @Post(':id/archive')
  @HttpCode(200)
  @ApiOperation({
    summary: 'Archiver une demande (E06.01, D03 à confirmer)',
    description:
      'Le propriétaire clôt la demande, publiée ou en brouillon : `publicationStatus` = `archived`, ' +
      '`archivedAt`. Les partages restent ouverts mais ne montrent plus sa présentation ; sa ' +
      'présentation n’est plus modifiable, elle ne peut être ni publiée ni présentée à une nouvelle ' +
      'structure tant qu’elle n’est pas désarchivée. Ses candidatures gardent leur statut de ' +
      'financement dans chaque structure. Ses publications dans les viviers des structures sont ' +
      'retirées (E07.02, `pool_publication_withdrawn`, raison `archived`) ; la désarchiver ne les ' +
      'rétablit pas. Sans effet sur une demande archivée. Propriétaire seul (`404` sinon). ' +
      'Journalisé (`dossier_archived`).',
  })
  @ApiOkResponse({ description: 'Demande archivée.' })
  @ApiNotFoundResponse({ description: 'Dossier inexistant ou possédé par un autre user.' })
  archive(@Req() req: Request, @Param('id') id: string): Promise<Dossier> {
    return this.service.archive(id, currentUser(req).id)
  }

  @Post(':id/unarchive')
  @HttpCode(200)
  @ApiOperation({
    summary: 'Désarchiver une demande (E06.01, D03 à confirmer)',
    description:
      'Retour au brouillon (`publicationStatus` = `draft`) : la demande se republie si besoin. ' +
      'Sans effet sur un brouillon ; `409` sur une demande publiée. Propriétaire seul (`404` ' +
      'sinon). Journalisé (`dossier_unarchived`).',
  })
  @ApiOkResponse({ description: 'Demande en brouillon.' })
  @ApiConflictResponse({ description: 'Demande publiée.' })
  @ApiNotFoundResponse({ description: 'Dossier inexistant ou possédé par un autre user.' })
  unarchive(@Req() req: Request, @Param('id') id: string): Promise<Dossier> {
    return this.service.unarchive(id, currentUser(req).id)
  }

  @Delete(':id')
  @HttpCode(204)
  @ApiOperation({
    summary: 'Supprimer un dossier',
    description:
      'Cascade sur `share_links`. Les entrées `audit_log` sont conservées ' +
      '(append-only — `dossier_id` devient `null` via `ON DELETE SET NULL`). Seul le propriétaire peut supprimer. ' +
      'L’entreprise part avec son dernier dossier, et avec elle son profil (réponses, historique, documents ; E05.05) ; ' +
      'les fichiers restent dans le stockage, comme avant.',
  })
  @ApiNoContentResponse({ description: 'Dossier supprimé.' })
  @ApiNotFoundResponse({ description: 'Dossier inexistant ou possédé par un autre user.' })
  async delete(@Req() req: Request, @Param('id') id: string): Promise<void> {
    await this.service.delete(id, currentUser(req).id)
  }

  @Post(':id/submit')
  @HttpCode(200)
  @ApiOperation({
    summary: 'Soumettre un dossier',
    description:
      'Vérifie que toutes les questions obligatoires de la version du dossier ont une réponse (sinon 422, ' +
      '`error.details` liste les champs manquants), lance la classification puis renseigne `submittedAt`. ' +
      'Ré-appeler met à jour la classification sans changer la date de première soumission. Après ' +
      'soumission, les réponses restent corrigeables mais une réponse obligatoire ne peut plus être effacée. ' +
      'Chaque soumission est inscrite au journal du dossier (`dossier_submitted`, canal `site`).',
  })
  @ApiOkResponse({ description: 'Dossier soumis, classification appliquée.' })
  @ApiUnprocessableEntityResponse({ description: 'Réponses obligatoires manquantes.' })
  @ApiNotFoundResponse({ description: 'Dossier inexistant ou possédé par un autre user.' })
  submit(@Req() req: Request, @Param('id') id: string): Promise<Dossier> {
    return this.service.submit(id, currentUser(req).id, SITE_ORIGIN)
  }
}

// ROADMAP E05.07: the financing requests of an existing company.
@ApiTags('Entreprises')
@ApiBearerAuth('jwt')
@ApiUnauthorizedResponse({ description: 'JWT manquant, invalide, ou user désactivé.' })
@Controller('companies/:companyId/dossiers')
export class CompanyDossiersController {
  constructor(private readonly service: DossiersService) {}

  @Post()
  @HttpCode(201)
  @ApiParam({ name: 'companyId', description: 'UUID de l’entreprise' })
  @ApiOperation({
    summary: 'Créer une autre demande de financement de l’entreprise',
    description:
      'Nouveau dossier de l’entreprise, en brouillon, qui présente le même profil (réponses et ' +
      'bibliothèque) sans le ressaisir. Il ne sélectionne encore aucun document : ses partages n’en ' +
      'montrent aucun tant que le propriétaire n’en a pas choisi. Propriétaire de l’entreprise ' +
      'seulement (`404` identique pour une entreprise d’un autre compte ou inconnue ; `403` pour un ' +
      'compte qui ne peut pas posséder d’entreprise).',
  })
  @ApiCreatedResponse({ description: 'Dossier créé dans l’entreprise.' })
  @ApiForbiddenResponse({ description: 'Compte qui ne peut pas posséder d’entreprise.' })
  @ApiNotFoundResponse({ description: 'Entreprise inexistante ou d’un autre compte.' })
  create(
    @Req() req: Request,
    @Param('companyId') companyId: string,
    @Body() body: CreateCompanyDossierDto,
  ) {
    return this.service.createForCompany({ owner: currentUser(req), companyId, name: body.name })
  }
}
