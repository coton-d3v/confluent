import {
  ACCESS_LEVEL_LABELS,
  FINANCING_STATUS_LABELS,
  type Candidature,
  type PoolPublication,
} from '@confluent/shared'

const dateFr = (iso: string) => new Date(iso).toLocaleDateString('fr-FR')

// Where a publication stands, in a sentence for its owner (`owner`) or the workspace's
// conseillers (`workspace`), from @confluent/shared `poolPublicationState`.
export function poolPublicationSentence(
  publication: PoolPublication | null,
  view: { side: 'owner' | 'workspace'; financingStatus: Candidature['financingStatus'] },
): string {
  const owner = view.side === 'owner'
  if (!publication) {
    return owner
      ? 'Cette demande n’est pas publiée dans ce vivier.'
      : 'L’entreprise n’a pas publié cette demande dans votre vivier : elle seule peut le décider.'
  }
  const level = `« ${ACCESS_LEVEL_LABELS[publication.accessLevel]} »`
  const since = dateFr(publication.consentedAt)
  if (publication.state === 'withdrawn') {
    const when = dateFr(publication.withdrawnAt ?? publication.consentedAt)
    if (publication.withdrawnBecause === 'archived') {
      return `Retirée du vivier le ${when}, avec l’archivage de la demande.`
    }
    return owner
      ? `Retirée du vivier le ${when} par vous.`
      : `Retirée du vivier le ${when} par l’entreprise.`
  }
  const listed = owner
    ? `Publiée dans le vivier le ${since}, au niveau ${level}.`
    : `Publiée par l’entreprise dans votre vivier le ${since}, au niveau ${level}.`
  if (publication.state === 'listed') return listed
  if (publication.pausedBecause === 'financing_closed') {
    const status = FINANCING_STATUS_LABELS[view.financingStatus].toLowerCase()
    return `${listed} En pause : le suivi est clos (statut « ${status} ») ; elle réapparaîtra si le suivi est rouvert.`
  }
  return owner
    ? `${listed} En pause : la demande n’est plus publiée ; elle réapparaîtra dès que vous la publierez de nouveau.`
    : `${listed} En pause : l’entreprise a dépublié sa demande ; elle réapparaîtra si elle la publie de nouveau.`
}
