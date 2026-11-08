import { Controller, Get } from '@nestjs/common'
import { ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger'
import { Public } from '../../common/decorators/public.decorator'
import { QuestionnairesService, type VersionStructure } from './questionnaires.service'

@ApiTags('Questionnaire')
@Controller('questionnaires')
export class QuestionnairesController {
  constructor(private readonly service: QuestionnairesService) {}

  @Public()
  @Get('active')
  @ApiOperation({
    summary: 'Questionnaire actif (publié)',
    description:
      'Publique. Retourne la version publiée du formulaire des dossiers : `version`, `sections` ' +
      'ordonnées et `fields` triés par section puis position. ' +
      'Bootstrap automatique : si aucune version n’existe, crée la v1 (3 sections / 12 champs baseline).',
  })
  @ApiOkResponse({ description: 'Version publiée, sections et champs.' })
  getActive(): Promise<VersionStructure> {
    return this.service.getActive()
  }
}
