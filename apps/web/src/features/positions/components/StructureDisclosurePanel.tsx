import { useId, useState } from 'react'
import { toast } from 'sonner'
import { interestIdentityLabel, type OpportunityStructure } from '@confluent/shared'
import type { ApiError } from '@/lib/api-client'
import { disclosePosition, withdrawDisclosure } from '../api'

const dateFr = (iso: string) => new Date(iso).toLocaleDateString('fr-FR')

function failure(err: unknown, what: string): string {
  const e = err as Partial<ApiError> | undefined
  if (e?.status === undefined) return `${what} Vérifiez votre connexion puis réessayez.`
  if (e.status === 404) return 'Cette opportunité ne vous est plus accessible : rechargez la page.'
  return e.message ?? what
}

// ROADMAP E07.07, on an opportunity's page: each structure whose pool brings the request to the
// investor sees nothing of their position (mark of interest, pledge) unless they choose so here —
// unchecked by default, one choice per structure, withdrawn at any time.
export function StructureDisclosurePanel({
  dossierId,
  structures,
}: {
  dossierId: string
  structures: OpportunityStructure[]
}) {
  if (structures.length === 0) return null
  return (
    <section
      aria-labelledby="structures-heading"
      className="flex flex-col gap-3 rounded-lg border border-border bg-card p-4"
    >
      <h2 id="structures-heading" className="font-heading text-lg font-semibold text-foreground">
        Suivi par {structures.length === 1 ? 'la structure' : 'les structures'}
      </h2>
      <p className="text-sm text-muted-foreground">
        {structures.length === 1 ? 'La structure dont le vivier' : 'Les structures dont le vivier'}{' '}
        vous apporte cette demande ne voi{structures.length === 1 ? 't' : 'ent'} rien de votre
        intérêt ni de votre promesse, pas même leur existence, sauf si vous le choisissez ici.
      </p>
      <ul role="list" className="flex flex-col gap-3">
        {structures.map((s) => (
          <StructureChoice key={s.workspace.id} dossierId={dossierId} structure={s} />
        ))}
      </ul>
    </section>
  )
}

function StructureChoice({
  dossierId,
  structure,
}: {
  dossierId: string
  structure: OpportunityStructure
}) {
  const checkboxId = useId()
  const [disclosure, setDisclosure] = useState(structure.disclosure)
  // The box follows the click at once, and goes back if the choice is not saved.
  const [checked, setChecked] = useState(structure.disclosure !== null)
  const [busy, setBusy] = useState(false)
  const name = structure.workspace.name

  async function change(show: boolean) {
    setChecked(show)
    setBusy(true)
    try {
      if (show) {
        const given = await disclosePosition(dossierId, structure.workspace.id)
        setDisclosure({ id: given.id, disclosedAt: given.disclosedAt })
        toast.success(`${name} voit désormais votre positionnement sur cette demande.`)
      } else if (disclosure) {
        await withdrawDisclosure(disclosure.id)
        setDisclosure(null)
        toast.success(`${name} ne voit plus votre positionnement.`)
      }
    } catch (err) {
      setChecked(!show)
      toast.error(failure(err, 'Votre choix n’a pas été enregistré.'))
    } finally {
      setBusy(false)
    }
  }

  return (
    <li>
      <label htmlFor={checkboxId} className="flex items-start gap-2 text-sm text-foreground">
        <input
          id={checkboxId}
          type="checkbox"
          className="mt-0.5 size-4 shrink-0 accent-foreground"
          checked={checked}
          disabled={busy}
          onChange={(e) => void change(e.target.checked)}
        />
        <span className="min-w-0 wrap-anywhere">
          Montrer mon positionnement à {name}
          <span className="mt-0.5 block text-xs text-muted-foreground">
            Ses conseillers verront « {interestIdentityLabel(structure.shownAs)} », la date de votre
            marque d’intérêt et l’intention, le montant et la date de votre promesse — jamais votre
            commentaire, ni ce que vous choisissez de montrer au porteur. Vous pouvez retirer ce
            choix à tout moment.
          </span>
          {disclosure && (
            <span role="status" className="mt-1 block text-xs text-foreground">
              Montré à {name} depuis le {dateFr(disclosure.disclosedAt)}.
            </span>
          )}
        </span>
      </label>
    </li>
  )
}
