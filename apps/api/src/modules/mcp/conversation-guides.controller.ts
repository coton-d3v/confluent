import { Controller, Get } from '@nestjs/common'
import { ApiBearerAuth, ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger'
import type { ConversationGuide } from '@confluent/shared'
import { CurrentUser } from '../../common/decorators/current-user.decorator'
import type { AuthenticatedUser } from '../auth/strategies/jwt.strategy'
import { describeGuides } from './conversation-guides'

// E04.10: the conversation guides, for the site to show and copy (page « Applications IA »).
@ApiTags('OAuth')
@ApiBearerAuth('jwt')
@Controller('conversation-guides')
export class ConversationGuidesController {
  @Get()
  @ApiOperation({
    summary: 'Mes guides de conversation',
    description:
      'Guides à suivre avec un assistant IA connecté (MCP) : « Remplir mon dossier » pour les ' +
      'porteurs de projet et les administrateurs, « Créer mon formulaire » pour qui conçoit les ' +
      'formulaires. Même texte que les prompts MCP et l’outil `get_conversation_guide` ; ' +
      '`request` est la phrase à dire à un assistant qui ne propose pas les prompts. Liste vide ' +
      'pour un compte sans guide (financeur).',
  })
  @ApiOkResponse({ description: 'Guides proposés au compte connecté.' })
  list(@CurrentUser() user: AuthenticatedUser): ConversationGuide[] {
    return describeGuides(user)
  }
}
