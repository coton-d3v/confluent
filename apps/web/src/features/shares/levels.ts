import type { AccessLevel } from '@confluent/shared'

// E07.04: what each level lets a reader see, as the owner chooses it — for a nominative link and for
// a structure's pool alike (the same projection, `recipientView`).
export const ACCESS_LEVEL_DESCRIPTIONS: Record<AccessLevel, string> = {
  public: 'Le minimum : titre, présentation publiée et informations de base du profil',
  partiel: 'Détails du projet, sans les données financières ni les documents réservés au complet',
  complet: 'Tout le profil et les documents choisis pour la demande',
}

// « Public » names the narrowest level of an identified reading, never a publication: the request
// keeps its real title, unlike the anonymous showcase card of a workspace to come (E09).
export const PUBLIC_IS_NOT_PUBLISHED =
  '« Public » est le niveau le plus restreint, pas une mise en ligne : à chaque niveau, la demande n’est lue, sous son vrai titre, que par des personnes identifiées et connectées.'
