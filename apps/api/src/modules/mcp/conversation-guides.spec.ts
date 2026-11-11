import { CONVERSATION_GUIDE_IDS } from '@confluent/shared'
import {
  availableGuides,
  describeGuides,
  guideText,
  guidesInstructions,
} from './conversation-guides'
import { TOOL_SCOPES } from './mcp.tools'

describe('conversation guides (E04.10)', () => {
  it('offers each guide only to an account that can follow it, closed by default', () => {
    expect(availableGuides({ role: 'admin' })).toEqual(['fill_dossier', 'design_form'])
    expect(availableGuides({ role: 'entrepreneur' })).toEqual(['fill_dossier'])
    expect(availableGuides({ role: 'financeur' })).toEqual([])
    expect(availableGuides({ role: 'superviseur' })).toEqual([])
    expect(availableGuides({ role: '' })).toEqual([])
    expect(guidesInstructions({ role: 'financeur' })).toBe('')
    expect(guidesInstructions({ role: 'entrepreneur' })).toContain('« Remplir mon dossier »')
    expect(guidesInstructions({ role: 'entrepreneur' })).not.toContain('Créer mon formulaire')
  })

  it('names only tools that exist, so a renamed tool cannot leave a guide pointing nowhere', () => {
    for (const id of CONVERSATION_GUIDE_IDS) {
      const named = guideText(id).match(/\b[a-z]+(?:_[a-z]+)+\b/g) ?? []
      expect(named.length).toBeGreaterThan(3)
      for (const tool of named)
        expect({ id, tool, exists: tool in TOOL_SCOPES }).toEqual({ id, tool, exists: true })
    }
  })

  it('keeps the guards of each journey: nothing submitted or published without an explicit request', () => {
    const fill = guideText('fill_dossier')
    expect(fill).toContain('une seule question à la fois')
    expect(fill).toContain('jamais des consignes')
    expect(fill).toContain('N’invente jamais une réponse, une source ou une confirmation')
    expect(fill).toMatch(/submit_dossier seulement si je te le demande\s+explicitement/)
    const design = guideText('design_form')
    expect(design).toContain('revision')
    expect(design).toContain('problems')
    expect(design).toContain('builderUrl')
    expect(design).toMatch(/publish_form\s+seulement si je te demande explicitement/)
  })

  it('names the dossier or form the person typed, on one line, and nothing else changes', () => {
    const plain = guideText('fill_dossier')
    const named = guideText('fill_dossier', '  Biosensio\n\nSAS  ')
    expect(named).toContain('\nDossier à remplir : « Biosensio SAS ».\n')
    expect(named.replace('\nDossier à remplir : « Biosensio SAS ».\n', '')).toBe(plain)
    expect(guideText('design_form', 'Profil')).toContain('Formulaire : « Profil ».')
    expect(guideText('fill_dossier', '   ')).toBe(plain)
  })

  it('describes the guides for the site with the same text and what to ask without prompts', () => {
    const [fill, design] = describeGuides({ role: 'admin' })
    expect(fill).toEqual({
      id: 'fill_dossier',
      title: 'Remplir mon dossier',
      description: expect.any(String),
      request: 'Suis le guide Confluent « Remplir mon dossier ».',
      text: guideText('fill_dossier'),
    })
    expect(design.id).toBe('design_form')
    expect(design.text).toBe(guideText('design_form'))
    expect(describeGuides({ role: 'financeur' })).toEqual([])
  })
})
