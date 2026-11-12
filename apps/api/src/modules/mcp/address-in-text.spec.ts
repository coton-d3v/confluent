import { namesAddress } from './address-in-text'

describe('namesAddress', () => {
  const EVE = 'eve@fonds.fr'

  it('finds the whole address, whatever its case and the punctuation around it', () => {
    for (const text of [
      'Partage avec eve@fonds.fr au niveau partiel',
      'Oui, partage Biosensio avec EVE@FONDS.FR au niveau partiel',
      'Partage avec eve@fonds.fr.',
      'Partage avec eve@fonds.fr, merci',
      'Partage avec <eve@fonds.fr>',
      'Partage avec « eve@fonds.fr »',
      'Partage avec (eve@fonds.fr)',
      'mailto:eve@fonds.fr',
      'eve@fonds.fr',
      'Partage avec steve@fonds.fr et avec eve@fonds.fr',
    ]) {
      expect([text, namesAddress(text, EVE)]).toEqual([text, true])
    }
  })

  // Code review R64: an address contained in another one is not the address the person wrote.
  it('never takes an address contained in another one', () => {
    for (const text of [
      'Partage Biosensio avec steve@fonds.fr au niveau complet',
      'Partage avec genevieve@fonds.fr',
      'Partage avec a.eve@fonds.fr',
      'Partage avec x+eve@fonds.fr',
      'Partage avec andréeve@fonds.fr',
      'Partage avec eve@fonds.fra',
      'Partage avec eve@fonds.fr-invest.com',
      'Partage avec eve@fonds.fr.example.com',
      'Partage avec x@eve@fonds.fr',
      'Partage avec l’investisseuse dont on a parlé',
      '',
    ]) {
      expect([text, namesAddress(text, EVE)]).toEqual([text, false])
    }
    expect(namesAddress('Partage avec eve@fonds.fr', '')).toBe(false)
  })
})
