import type { FormUsage } from '@confluent/shared'
import { confluentFormsApi, workspaceFormsApi, type FormsApi } from '@/features/admin/forms.api'

// Where forms are designed (E05.09): Confluent's own forms — the company profile of every dossier —
// for its administrators, or one workspace's — its complementary form, answered by each candidature
// it receives — for its managers. The same builder serves both; what differs is said here.
export interface FormsPlace {
  api: FormsApi
  listPath: string
  editorPath: (formId: string) => string
  // The usage a form of this place is assigned to.
  usage: FormUsage
  // A workspace's forms ask for no attachment and are never read through a share.
  workspaceForm: boolean
  texts: {
    // « Utiliser pour … »
    assignAction: string
    assignTitle: string
    // Who answers the published version from now on, and who keeps theirs.
    forNew: string
    existingKeep: string
    // What a form archived or replaced leaves untouched.
    answeredWithIt: string
    createDescription: string
    intro: string
  }
}

export const CONFLUENT_FORMS: FormsPlace = {
  api: confluentFormsApi,
  listPath: '/admin/formulaires',
  editorPath: (formId) => `/admin/formulaires/${formId}`,
  usage: 'dossier',
  workspaceForm: false,
  texts: {
    assignAction: 'Utiliser pour les nouveaux dossiers',
    assignTitle: 'Utiliser ce formulaire pour les nouveaux dossiers ?',
    forNew: 'les nouveaux dossiers',
    existingKeep: 'Les dossiers existants gardent leur version et leurs réponses.',
    answeredWithIt: 'les dossiers créés avec lui',
    createDescription:
      'Le formulaire est créé avec un brouillon vide, non affecté : il ne sert à aucun dossier tant qu’il n’est pas publié et affecté.',
    intro:
      'Chaque formulaire évolue par brouillon puis publication. Un dossier garde toujours la version avec laquelle il a été créé.',
  },
}

export function workspaceFormsPlace(workspaceId: string): FormsPlace {
  const base = `/admin/workspaces/${workspaceId}/formulaires`
  return {
    api: workspaceFormsApi(workspaceId),
    listPath: base,
    editorPath: (formId) => `${base}/${formId}`,
    usage: 'candidature',
    workspaceForm: true,
    texts: {
      assignAction: 'Utiliser pour les candidatures',
      assignTitle: 'Utiliser ce formulaire pour les candidatures ?',
      forNew: 'les nouvelles candidatures',
      existingKeep: 'Les candidatures déjà ouvertes gardent leur version et leurs réponses.',
      answeredWithIt: 'les candidatures qui y répondent',
      createDescription:
        'Le formulaire est créé avec un brouillon vide, non affecté : aucune entreprise n’y répond tant qu’il n’est pas publié et affecté aux candidatures.',
      intro:
        'Le formulaire complémentaire de votre structure, en plus du profil commun que chaque entreprise renseigne une seule fois. Les entreprises qui vous présentent une demande y répondent ; leurs réponses ne sont lues que par les conseillers de ce workspace.',
    },
  }
}
