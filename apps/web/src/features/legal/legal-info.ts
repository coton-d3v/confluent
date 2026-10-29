// Source unique des informations légales affichées sur /mentions-legales et /confidentialite.
// Renseignées le 29/10/2026 — à double-valider avant la mise en service (story 10.8 du cadrage V1).
export const LEGAL_INFO = {
  productName: 'Confluent',
  publisher: {
    name: 'Coton',
    legalForm: 'SAS (société par actions simplifiée)',
    registration: 'SIRET 845 060 326 00038',
    address: '12 rue du Sault, 37420 Rigny-Ussé',
    email: 'confluent@coton.dev',
    publicationDirector: 'Jean-Baptiste Beuzelin',
  },
  founders: [
    { name: 'Jean-Baptiste Beuzelin', role: 'Co-fondateur — produit & technique' },
    { name: 'Benjamin Peri', role: 'Co-fondateur — écosystème & partenariats' },
  ],
  host: {
    name: 'IONOS SARL',
    address: '7 place de la Gare, BP 70109, 57200 Sarreguemines Cedex — 09 70 80 89 11',
    location: 'France',
  },
  privacyContact: 'confluent@coton.dev',
  lastUpdated: '29 octobre 2026',
} as const
