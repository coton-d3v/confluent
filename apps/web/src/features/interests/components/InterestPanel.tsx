import { useId, useState } from 'react'
import { toast } from 'sonner'
import {
  interestIdentityLabel,
  type InterestIdentity,
  type OpportunityInterest,
} from '@confluent/shared'
import { Button } from '@/components/ui/button'
import type { ApiError } from '@/lib/api-client'
import { markInterest, withdrawInterest } from '../api'

const dateFr = (iso: string) => new Date(iso).toLocaleDateString('fr-FR')

function failure(err: unknown, what: string): string {
  const e = err as Partial<ApiError> | undefined
  if (e?.status === undefined) return `${what} Vérifiez votre connexion puis réessayez.`
  if (e.status === 404) return 'Cette opportunité ne vous est plus accessible : rechargez la page.'
  return e.message ?? what
}

// ROADMAP E07.05, on an opportunity's page: the investor marks their interest (once), chooses
// whether the owner may see who they are — unchecked by default (D05) — and may change that or
// withdraw at any time. An archived request takes no new mark nor a name newly shown.
export function InterestPanel({
  dossierId,
  archived,
  interest: initial,
  shownAs,
}: {
  dossierId: string
  archived: boolean
  interest: OpportunityInterest | null
  shownAs: InterestIdentity
}) {
  const checkboxId = useId()
  const [interest, setInterest] = useState(initial)
  // Before a mark: the choice the mark will carry.
  const [nameVisible, setNameVisible] = useState(initial?.nameVisible ?? false)
  const [busy, setBusy] = useState(false)
  const identity = interestIdentityLabel(shownAs)

  async function save(next: boolean) {
    setBusy(true)
    try {
      const saved = await markInterest(dossierId, next)
      setInterest(saved)
      setNameVisible(saved.nameVisible)
      toast.success(
        interest === null
          ? 'Votre intérêt est transmis au porteur.'
          : saved.nameVisible
            ? 'Le porteur voit désormais votre nom.'
            : 'Le porteur ne voit plus votre nom.',
      )
    } catch (err) {
      setNameVisible(interest?.nameVisible ?? next)
      toast.error(failure(err, 'Votre choix n’a pas été enregistré.'))
    } finally {
      setBusy(false)
    }
  }

  async function withdraw() {
    setBusy(true)
    try {
      await withdrawInterest(dossierId)
      setInterest(null)
      setNameVisible(false)
      toast.success('Votre marque d’intérêt est retirée.')
    } catch (err) {
      toast.error(failure(err, 'Le retrait n’a pas été enregistré.'))
    } finally {
      setBusy(false)
    }
  }

  // Showing one's name newly is refused on an archived request; hiding it never is.
  const checkboxDisabled = busy || (archived && !(interest?.nameVisible ?? false))

  return (
    <section
      aria-labelledby="interest-heading"
      className="flex flex-col gap-3 rounded-lg border border-border bg-card p-4"
    >
      <h2 id="interest-heading" className="font-heading text-lg font-semibold text-foreground">
        Votre intérêt
      </h2>
      {interest ? (
        <p role="status" className="text-sm text-foreground">
          Vous avez marqué votre intérêt le {dateFr(interest.markedAt)}.{' '}
          {interest.nameVisible
            ? 'Le porteur voit votre nom.'
            : 'Le porteur le compte, sans savoir qu’il vient de vous.'}
        </p>
      ) : (
        <p className="text-sm text-muted-foreground">
          Faites savoir au porteur que cette demande vous intéresse. Ce n’est ni une promesse ni un
          engagement de financement.
        </p>
      )}
      {archived && (
        <p
          role="note"
          className="rounded-md border border-border bg-muted/40 px-3 py-2 text-sm text-foreground"
        >
          Cette demande est archivée par son porteur : vous ne pouvez plus y marquer votre intérêt
          ni y montrer votre nom. Vous pouvez toujours masquer votre nom ou retirer votre marque.
        </p>
      )}
      {(interest || !archived) && (
        <label htmlFor={checkboxId} className="flex items-start gap-2 text-sm text-foreground">
          <input
            id={checkboxId}
            type="checkbox"
            className="mt-0.5 size-4 shrink-0 accent-foreground"
            checked={nameVisible}
            disabled={checkboxDisabled}
            onChange={(e) => {
              const next = e.target.checked
              setNameVisible(next)
              if (interest) void save(next)
            }}
          />
          <span className="min-w-0 wrap-anywhere">
            Montrer mon nom au porteur : « {identity} »
            <span className="mt-0.5 block text-xs text-muted-foreground">
              Sinon, il voit seulement le nombre d’investisseurs intéressés. Vous pouvez changer
              d’avis à tout moment.
            </span>
          </span>
        </label>
      )}
      <div className="flex flex-wrap gap-2">
        {interest ? (
          <Button
            type="button"
            variant="outline"
            className="min-h-11"
            disabled={busy}
            onClick={() => void withdraw()}
          >
            Retirer mon intérêt
          </Button>
        ) : (
          <Button
            type="button"
            className="min-h-11"
            disabled={busy || archived}
            onClick={() => void save(nameVisible)}
          >
            Marquer mon intérêt
          </Button>
        )}
      </div>
    </section>
  )
}
