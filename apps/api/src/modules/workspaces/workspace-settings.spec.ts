import {
  createWorkspaceSchema,
  normalizeEmailDomain,
  updateWorkspaceSchema,
} from '@confluent/shared'

// Settings rules shared by the site and the API (@confluent/shared workspace.schema.ts).
describe('workspace settings', () => {
  it('normalises the email domain and refuses anything that is not a bare domain', () => {
    expect(normalizeEmailDomain(' @CCI-Touraine.FR ')).toBe('cci-touraine.fr')
    expect(normalizeEmailDomain('exämple.fr')).toBe('xn--exmple-cua.fr')
    expect(normalizeEmailDomain('tours.cci.fr')).toBe('tours.cci.fr')
    for (const value of [
      'contact@cci.fr',
      'cci.fr/admin',
      'https://cci.fr',
      'cci.fr:25',
      'localhost',
      '192.168.1.1',
      'cci_tours.fr',
      'cci.fr.',
      '.fr',
      '%63ci.fr',
    ]) {
      expect(normalizeEmailDomain(value)).toBeNull()
    }
  })

  it('keeps the presentation as plain text, bounded, without HTML tags', () => {
    const parse = (presentation: string) =>
      createWorkspaceSchema.safeParse({ name: 'CCI', presentation })
    expect(parse('Chiffre d’affaires < 1 M€ et effectif > 2').success).toBe(true)
    expect(parse(' Ligne 1\r\nLigne 2 ').data?.presentation).toBe('Ligne 1\nLigne 2')
    expect(parse('<img src=x onerror=alert(1)>').success).toBe(false)
    expect(parse('<!-- commentaire -->').success).toBe(false)
    expect(parse('a'.repeat(5000)).success).toBe(true)
    expect(parse('a'.repeat(5001)).success).toBe(false)
    expect(parse('   ').data?.presentation).toBeNull()
  })

  it('accepts #RRGGBB colours only, stored in lower case', () => {
    const color = (value: string) => updateWorkspaceSchema.safeParse({ color: value }).data?.color
    expect(color('#A1B2C3')).toBe('#a1b2c3')
    expect(color('')).toBeNull()
    for (const value of ['#abc', 'a1b2c3', '#a1b2c3ff', 'red', 'rgb(0,0,0)']) {
      expect(updateWorkspaceSchema.safeParse({ color: value }).success).toBe(false)
    }
  })

  it('never lets an update change the slug', () => {
    expect(updateWorkspaceSchema.safeParse({ slug: 'autre' }).success).toBe(false)
    expect(updateWorkspaceSchema.safeParse({ name: 'CCI', slug: 'autre' }).success).toBe(false)
  })
})
