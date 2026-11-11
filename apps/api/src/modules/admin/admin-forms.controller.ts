import {
  Body,
  Controller,
  Delete,
  Get,
  Headers,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Put,
  UseGuards,
  createParamDecorator,
  type ExecutionContext,
} from '@nestjs/common'
import {
  ApiBearerAuth,
  ApiConflictResponse,
  ApiForbiddenResponse,
  ApiNoContentResponse,
  ApiParam,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
  ApiUnauthorizedResponse,
  ApiUnprocessableEntityResponse,
} from '@nestjs/swagger'
import {
  assignFormUsageSchema,
  createDraftFieldSchema,
  createDraftSectionSchema,
  createFormSchema,
  duplicateFormSchema,
  renameFormSchema,
  reorderSchema,
  updateDraftFieldSchema,
  updateDraftSectionSchema,
} from '@confluent/shared'
import type { Request } from 'express'
import { createZodDto } from 'nestjs-zod'
import { SITE_ORIGIN } from '../audit/action-origin'
import type { AuthenticatedUser } from '../auth/strategies/jwt.strategy'
import type { FormDesigner } from '../questionnaires/form-design-access'
import { FormDraftsService, type FormVersionView } from '../questionnaires/form-drafts.service'
import {
  FormsService,
  type FormDetailView,
  type FormSummaryView,
} from '../questionnaires/forms.service'
import { WorkspaceAccessGuard } from '../workspaces/workspace-access.guard'

class CreateFormDto extends createZodDto(createFormSchema) {}
class AssignUsageDto extends createZodDto(assignFormUsageSchema) {}
class RenameFormDto extends createZodDto(renameFormSchema) {}
class DuplicateFormDto extends createZodDto(duplicateFormSchema) {}
class CreateSectionDto extends createZodDto(createDraftSectionSchema) {}
class UpdateSectionDto extends createZodDto(updateDraftSectionSchema) {}
class CreateFieldDto extends createZodDto(createDraftFieldSchema) {}
class UpdateFieldDto extends createZodDto(updateDraftFieldSchema) {}
class ReorderDto extends createZodDto(reorderSchema) {}

const uuid = new ParseUUIDPipe()

// `If-Match: <draft updatedAt>` (optional): the change is refused with 409 if the draft changed since
// the client read it — two administrators editing the same draft (code review R30).
const revisionOf = (header: string | undefined) =>
  header?.replace(/^(W\/)?"(.*)"$/, '$2') || undefined

// Who designs forms in this request, and whose forms (E05.09): the authenticated account, in the
// workspace the URL names (`:workspaceId`, checked by WorkspaceAccessGuard before the body), or
// among Confluent's own forms on a route without one. Never a value read from a body.
const Designer = createParamDecorator((_data: unknown, ctx: ExecutionContext): FormDesigner => {
  const req = ctx.switchToHttp().getRequest<Request & { user: AuthenticatedUser }>()
  const workspaceId = req.params.workspaceId
  return {
    id: req.user.id,
    role: req.user.role,
    workspaceId: workspaceId === undefined ? null : String(workspaceId),
  }
})

// Form builder (ROADMAP E03.02, E03.03, E03.07, E03.08). Structure edits address `…/draft/…`: the
// published and archived versions, read by dossiers, cannot be reached for writing. Who may read or
// change forms is decided by the services' single form design rule (E04.07), the one the MCP tools
// go through too, not by a guard of its own here. The same routes serve Confluent's own forms and,
// E05.09, each workspace's (below): the services keep each designer to its owner's forms.
abstract class FormBuilderRoutes {
  constructor(
    private readonly forms: FormsService,
    private readonly drafts: FormDraftsService,
  ) {}

  @Get()
  @ApiOperation({
    summary: 'Lister les formulaires',
    description:
      'Tous les formulaires, archivés compris (`archivedAt`), avec leur version publiée et leur brouillon.',
  })
  @ApiOkResponse({ description: 'Formulaires.' })
  list(@Designer() user: FormDesigner): Promise<FormSummaryView[]> {
    return this.forms.list(user)
  }

  @Post()
  @ApiOperation({
    summary: 'Créer un formulaire',
    description:
      'Crée un formulaire non affecté (`usage: null`) avec un brouillon vide (version 1). Le `slug` est ' +
      'dérivé du nom et ne change plus.',
  })
  create(@Body() body: CreateFormDto, @Designer() user: FormDesigner): Promise<FormDetailView> {
    return this.forms.create(user, body.name)
  }

  @Get(':formId')
  @ApiOperation({ summary: 'Détail d’un formulaire et de toutes ses versions' })
  @ApiNotFoundResponse({ description: 'Formulaire inexistant.' })
  get(
    @Param('formId', uuid) formId: string,
    @Designer() user: FormDesigner,
  ): Promise<FormDetailView> {
    return this.forms.get(user, formId)
  }

  @Patch(':formId')
  @ApiOperation({ summary: 'Renommer un formulaire (le slug est conservé)' })
  @ApiConflictResponse({ description: 'Formulaire archivé.' })
  rename(
    @Param('formId', uuid) formId: string,
    @Body() body: RenameFormDto,
    @Designer() user: FormDesigner,
  ): Promise<FormDetailView> {
    return this.forms.rename(user, formId, body.name)
  }

  @Post(':formId/duplicate')
  @ApiOperation({
    summary: 'Dupliquer un formulaire',
    description:
      'Nouveau formulaire non affecté dont le brouillon copie la version publiée de l’original (ou sa ' +
      'dernière version) avec les mêmes clés de champs et de choix.',
  })
  duplicate(
    @Param('formId', uuid) formId: string,
    @Body() body: DuplicateFormDto,
    @Designer() user: FormDesigner,
  ): Promise<FormDetailView> {
    return this.forms.duplicate(user, formId, body.name)
  }

  @Put(':formId/usage')
  @ApiOperation({
    summary: 'Affecter un formulaire à un usage',
    description:
      '`usage: "dossier"` (formulaires de Confluent) : les nouveaux dossiers sont créés avec la ' +
      'version publiée de ce formulaire, qui remplace le précédent dans la même transaction. Les ' +
      'dossiers existants gardent leur version. `usage: "candidature"` (formulaires d’un workspace, ' +
      'E05.09) : formulaire complémentaire du workspace, à la place du précédent ; les nouvelles ' +
      'candidatures répondent à sa version publiée, les existantes gardent la leur. Refusé pour un ' +
      'formulaire jamais publié ou archivé, et pour un usage qui n’est pas celui de son propriétaire (`400`).',
  })
  @ApiConflictResponse({ description: 'Formulaire jamais publié, ou archivé.' })
  assignUsage(
    @Param('formId', uuid) formId: string,
    @Body() body: AssignUsageDto,
    @Designer() user: FormDesigner,
  ): Promise<FormDetailView> {
    return this.forms.assignUsage(user, formId, body.usage)
  }

  @Post(':formId/archive')
  @HttpCode(200)
  @ApiOperation({
    summary: 'Archiver un formulaire',
    description:
      'Le formulaire et ses versions restent lisibles (les dossiers gardent la leur) mais ne sont plus ' +
      'modifiables. Refusé pour un formulaire affecté à un usage.',
  })
  @ApiConflictResponse({ description: 'Formulaire affecté à un usage.' })
  archive(
    @Param('formId', uuid) formId: string,
    @Designer() user: FormDesigner,
  ): Promise<FormDetailView> {
    return this.forms.archive(user, formId)
  }

  @Post(':formId/restore')
  @HttpCode(200)
  @ApiOperation({ summary: 'Restaurer un formulaire archivé' })
  restore(
    @Param('formId', uuid) formId: string,
    @Designer() user: FormDesigner,
  ): Promise<FormDetailView> {
    return this.forms.restore(user, formId)
  }

  @Get(':formId/versions/:versionId')
  @ApiOperation({
    summary: 'Structure d’une version',
    description:
      'Sections et champs ordonnés d’une version du formulaire ; pour un brouillon, `problems` liste ce ' +
      'qui empêche encore sa publication.',
  })
  @ApiNotFoundResponse({ description: 'Version inexistante dans ce formulaire.' })
  version(
    @Param('formId', uuid) formId: string,
    @Param('versionId', uuid) versionId: string,
    @Designer() user: FormDesigner,
  ): Promise<FormVersionView> {
    return this.drafts.getVersion(user, formId, versionId)
  }

  @Get(':formId/draft')
  @ApiOperation({ summary: 'Brouillon en cours' })
  @ApiNotFoundResponse({ description: 'Aucun brouillon.' })
  draft(
    @Param('formId', uuid) formId: string,
    @Designer() user: FormDesigner,
  ): Promise<FormVersionView> {
    return this.drafts.getDraft(user, formId)
  }

  @Post(':formId/draft')
  @ApiOperation({
    summary: 'Ouvrir un brouillon',
    description:
      'Copie la version publiée (mêmes clés : les réponses et la classification se lisent pareil) ou ' +
      'part d’un formulaire vide s’il n’a jamais été publié.',
  })
  @ApiConflictResponse({ description: 'Un brouillon existe déjà, ou formulaire archivé.' })
  createDraft(
    @Param('formId', uuid) formId: string,
    @Designer() user: FormDesigner,
  ): Promise<FormVersionView> {
    return this.drafts.createDraft(user, formId)
  }

  @Delete(':formId/draft')
  @HttpCode(204)
  @ApiOperation({ summary: 'Abandonner le brouillon' })
  @ApiNoContentResponse({ description: 'Brouillon supprimé.' })
  discardDraft(
    @Param('formId', uuid) formId: string,
    @Designer() user: FormDesigner,
    @Headers('if-match') ifMatch?: string,
  ): Promise<void> {
    return this.drafts.discardDraft(user, formId, revisionOf(ifMatch))
  }

  @Post(':formId/draft/publish')
  @HttpCode(200)
  @ApiOperation({
    summary: 'Publier le brouillon',
    description:
      'Le brouillon devient la version publiée ; la précédente est archivée dans la même transaction. ' +
      'Les dossiers existants gardent leur version.',
  })
  @ApiUnprocessableEntityResponse({
    description: 'Brouillon incomplet : `error.details` liste les problèmes.',
  })
  publish(
    @Param('formId', uuid) formId: string,
    @Designer() user: FormDesigner,
    @Headers('if-match') ifMatch?: string,
  ): Promise<FormVersionView> {
    return this.drafts.publishDraft(user, formId, revisionOf(ifMatch), SITE_ORIGIN)
  }

  @Post(':formId/draft/sections')
  @ApiOperation({ summary: 'Ajouter une section (en dernière position)' })
  addSection(
    @Param('formId', uuid) formId: string,
    @Body() body: CreateSectionDto,
    @Designer() user: FormDesigner,
    @Headers('if-match') ifMatch?: string,
  ): Promise<FormVersionView> {
    return this.drafts.addSection(user, formId, body, revisionOf(ifMatch))
  }

  @Put(':formId/draft/sections/order')
  @ApiOperation({ summary: 'Réordonner les sections (`ids` : toutes les sections, dans l’ordre)' })
  reorderSections(
    @Param('formId', uuid) formId: string,
    @Body() body: ReorderDto,
    @Designer() user: FormDesigner,
    @Headers('if-match') ifMatch?: string,
  ): Promise<FormVersionView> {
    return this.drafts.reorderSections(user, formId, body.ids, revisionOf(ifMatch))
  }

  @Patch(':formId/draft/sections/:sectionId')
  @ApiOperation({ summary: 'Modifier une section' })
  updateSection(
    @Param('formId', uuid) formId: string,
    @Param('sectionId', uuid) sectionId: string,
    @Body() body: UpdateSectionDto,
    @Designer() user: FormDesigner,
    @Headers('if-match') ifMatch?: string,
  ): Promise<FormVersionView> {
    return this.drafts.updateSection(user, formId, sectionId, body, revisionOf(ifMatch))
  }

  @Delete(':formId/draft/sections/:sectionId')
  @ApiOperation({ summary: 'Retirer une section et ses champs' })
  removeSection(
    @Param('formId', uuid) formId: string,
    @Param('sectionId', uuid) sectionId: string,
    @Designer() user: FormDesigner,
    @Headers('if-match') ifMatch?: string,
  ): Promise<FormVersionView> {
    return this.drafts.removeSection(user, formId, sectionId, revisionOf(ifMatch))
  }

  @Put(':formId/draft/sections/:sectionId/fields/order')
  @ApiOperation({ summary: 'Réordonner les champs d’une section (`ids` : tous ses champs)' })
  reorderFields(
    @Param('formId', uuid) formId: string,
    @Param('sectionId', uuid) sectionId: string,
    @Body() body: ReorderDto,
    @Designer() user: FormDesigner,
    @Headers('if-match') ifMatch?: string,
  ): Promise<FormVersionView> {
    return this.drafts.reorderFields(user, formId, sectionId, body.ids, revisionOf(ifMatch))
  }

  @Post(':formId/draft/fields')
  @ApiOperation({
    summary: 'Ajouter un champ (en dernière position de sa section)',
    description:
      'Sans `key`, elle est dérivée du libellé. Sans `minAccessLevel`, le champ n’est lisible qu’avec ' +
      'un partage complet. `choices` (`{ key?, label }`) n’est accepté que pour une liste.',
  })
  addField(
    @Param('formId', uuid) formId: string,
    @Body() body: CreateFieldDto,
    @Designer() user: FormDesigner,
    @Headers('if-match') ifMatch?: string,
  ): Promise<FormVersionView> {
    return this.drafts.addField(user, formId, body, revisionOf(ifMatch))
  }

  @Patch(':formId/draft/fields/:fieldId')
  @ApiOperation({
    summary: 'Modifier un champ',
    description:
      '`choices` remplace la liste complète : reprendre la `key` des choix conservés. Un `sectionId` ' +
      'différent déplace le champ en fin de cette section.',
  })
  updateField(
    @Param('formId', uuid) formId: string,
    @Param('fieldId', uuid) fieldId: string,
    @Body() body: UpdateFieldDto,
    @Designer() user: FormDesigner,
    @Headers('if-match') ifMatch?: string,
  ): Promise<FormVersionView> {
    return this.drafts.updateField(user, formId, fieldId, body, revisionOf(ifMatch))
  }

  @Delete(':formId/draft/fields/:fieldId')
  @ApiOperation({ summary: 'Retirer un champ' })
  removeField(
    @Param('formId', uuid) formId: string,
    @Param('fieldId', uuid) fieldId: string,
    @Designer() user: FormDesigner,
    @Headers('if-match') ifMatch?: string,
  ): Promise<FormVersionView> {
    return this.drafts.removeField(user, formId, fieldId, revisionOf(ifMatch))
  }
}

// Confluent's own forms — the company profile (`usage: "dossier"`) and the others — for its
// administrators.
@ApiTags('Admin · Formulaires')
@ApiBearerAuth('jwt')
@ApiUnauthorizedResponse({ description: 'JWT manquant.' })
@ApiForbiddenResponse({ description: 'Compte non autorisé à concevoir les formulaires.' })
@Controller('admin/forms')
export class AdminFormsController extends FormBuilderRoutes {
  constructor(forms: FormsService, drafts: FormDraftsService) {
    super(forms, drafts)
  }
}

// E05.09: a workspace's own forms — its complementary form (`usage: "candidature"`), answered by
// each candidature it receives, and its drafts — for whoever manages the workspace (its managers,
// Confluent's administrators). A form of Confluent or of another workspace is not found here, nor a
// workspace's form under `admin/forms`. Attachment fields are refused: documents stay in the
// company's library.
@ApiTags('Workspaces · Formulaires')
@ApiBearerAuth('jwt')
@ApiParam({ name: 'workspaceId', description: 'UUID du workspace' })
@ApiUnauthorizedResponse({ description: 'JWT manquant.' })
@ApiForbiddenResponse({
  description:
    'Membre du workspace qui n’en est pas gestionnaire (conseiller sans droit, investisseur).',
})
@ApiNotFoundResponse({
  description:
    'Workspace inexistant ou dont le compte n’est pas membre actif (même réponse) ; formulaire ' +
    'inexistant ou d’un autre propriétaire (Confluent, autre workspace).',
})
@UseGuards(WorkspaceAccessGuard)
@Controller('admin/workspaces/:workspaceId/forms')
export class WorkspaceFormsController extends FormBuilderRoutes {
  constructor(forms: FormsService, drafts: FormDraftsService) {
    super(forms, drafts)
  }
}
