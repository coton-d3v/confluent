import { useId, useState } from 'react'
import { toast } from 'sonner'
import {
  PLEDGE_INTENTIONS,
  PLEDGE_INTENTION_HINTS,
  PLEDGE_INTENTION_LABELS,
  PLEDGE_LIMITS,
  PLEDGE_NON_COMMITMENT,
  interestIdentityLabel,
  pledgeInputSchema,
  type InterestIdentity,
  type OpportunityPledge,
  type PledgeIntention,
} from '@confluent/shared'
import { ConfirmDialog, type ConfirmRequest } from '@/components/confluent/ConfirmDialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { formatAmount, parseAmount } from '@/features/dossiers/presentation'
import type { ApiError } from '@/lib/api-client'
import { setPledge, withdrawPledge } from '../api'

const dateFr = (iso: string) => new Date(iso).toLocaleDateString('fr-FR')

// A change on a later day than the pledge. Not read from `version`, an opaque revision shared by
// every pledge (code review R63, P3 of #131): a first pledge may carry any number.
const changedLater = (p: { pledgedAt: string; updatedAt: string }) =>
  dateFr(p.updatedAt) !== dateFr(p.pledgedAt)

type Field = 'intention' | 'amountEur' | 'comment' | 'showName' | 'showAmount'

interface Draft {
  intention: PledgeIntention | null
  amount: string
  comment: string
  showName: boolean
  showAmount: boolean
}

// Unchecked by default: the owner sees only the count and the total unless the investor chooses.
const EMPTY: Draft = {
  intention: null,
  amount: '',
  comment: '',
  showName: false,
  showAmount: false,
}

function draftOf(pledge: OpportunityPledge): Draft {
  return {
    intention: pledge.intention,
    amount: String(pledge.amountEur),
    comment: pledge.comment ?? '',
    showName: pledge.showName,
    showAmount: pledge.showAmount,
  }
}

function failure(err: unknown, what: string): string {
  const e = err as Partial<ApiError> | undefined
  if (e?.status === undefined) return `${what} Vérifiez votre connexion puis réessayez.`
  if (e.status === 404) return 'Cette opportunité ne vous est plus accessible : rechargez la page.'
  if (e.status === 400) return `${what} Vérifiez les champs de votre promesse.`
  return e.message ?? what
}

// What the owner sees of this pledge, besides the count and the total.
function shownToOwner(p: { showName: boolean; showAmount: boolean }): string {
  if (p.showName && p.showAmount) return 'votre nom et votre montant'
  if (p.showName) return 'votre nom, pas votre montant'
  if (p.showAmount) return 'votre montant, pas votre nom'
  return 'ni votre nom ni votre montant'
}

// ROADMAP E07.06, on an opportunity's page: the investor makes one pledge — intention, amount,
// optional comment, and whether the owner may see their name and their amount (unchecked by
// default) —, changes it from the version they read or withdraws it until the request is closed
// (archived). Once closed it is kept as is; hiding one's name or amount stays possible. The
// non-commitment mention is shown before any pledge and with the pledge.
export function PledgePanel({
  dossierId,
  archived,
  pledge: initial,
  shownAs,
}: {
  dossierId: string
  archived: boolean
  pledge: OpportunityPledge | null
  shownAs: InterestIdentity
}) {
  const ids = {
    amount: useId(),
    comment: useId(),
    showName: useId(),
    showAmount: useId(),
    intention: useId(),
  }
  const [pledge, setCurrent] = useState(initial)
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState<Draft>(initial ? draftOf(initial) : EMPTY)
  const [errors, setErrors] = useState<Partial<Record<Field, string>>>({})
  const [busy, setBusy] = useState(false)
  const [confirm, setConfirm] = useState<ConfirmRequest | null>(null)
  const identity = interestIdentityLabel(shownAs)
  const formOpen = !archived && (pledge === null || editing)

  const set = <K extends keyof Draft>(key: K, value: Draft[K]) =>
    setDraft((d) => ({ ...d, [key]: value }))

  async function save(input: Parameters<typeof setPledge>[1], success: string) {
    setBusy(true)
    try {
      const saved = await setPledge(dossierId, input)
      setCurrent(saved)
      setDraft(draftOf(saved))
      setEditing(false)
      setErrors({})
      toast.success(success)
    } catch (err) {
      toast.error(failure(err, 'Votre promesse n’a pas été enregistrée.'))
    } finally {
      setBusy(false)
    }
  }

  function submit(e: React.FormEvent) {
    e.preventDefault()
    const amount = parseAmount(draft.amount)
    const parsed = pledgeInputSchema.safeParse({
      intention: draft.intention ?? undefined,
      amountEur: typeof amount === 'number' ? amount : undefined,
      comment: draft.comment,
      showName: draft.showName,
      showAmount: draft.showAmount,
      version: pledge?.version ?? null,
    })
    if (!parsed.success) {
      const next: Partial<Record<Field, string>> = {}
      for (const issue of parsed.error.issues) {
        const field = issue.path[0] as Field
        next[field] ??= issue.message
      }
      if (amount === 'invalid') next.amountEur = 'Indiquez un montant en euros, sans centimes.'
      setErrors(next)
      return
    }
    setErrors({})
    void save(
      { ...parsed.data, comment: parsed.data.comment ?? null },
      pledge === null ? 'Votre promesse est enregistrée.' : 'Votre promesse est modifiée.',
    )
  }

  // On a closed request: take back a consent, the rest unchanged.
  function hide(what: 'showName' | 'showAmount') {
    if (!pledge) return
    void save(
      {
        intention: pledge.intention,
        amountEur: pledge.amountEur,
        comment: pledge.comment,
        showName: what === 'showName' ? false : pledge.showName,
        showAmount: what === 'showAmount' ? false : pledge.showAmount,
        version: pledge.version,
      },
      what === 'showName'
        ? 'Le porteur ne voit plus votre nom.'
        : 'Le porteur ne voit plus votre montant.',
    )
  }

  async function withdraw() {
    setBusy(true)
    try {
      await withdrawPledge(dossierId)
      setCurrent(null)
      setDraft(EMPTY)
      setEditing(false)
      toast.success('Votre promesse est retirée.')
    } catch (err) {
      toast.error(failure(err, 'Le retrait n’a pas été enregistré.'))
    } finally {
      setBusy(false)
    }
  }

  const error = (field: Field, id: string) =>
    errors[field] ? (
      <p id={`${id}-error`} className="text-xs text-destructive">
        {errors[field]}
      </p>
    ) : null
  const described = (field: Field, id: string) =>
    errors[field] ? { 'aria-invalid': true, 'aria-describedby': `${id}-error` } : {}
  const parsedAmount = parseAmount(draft.amount)

  return (
    <section
      aria-labelledby="pledge-heading"
      className="flex flex-col gap-3 rounded-lg border border-border bg-card p-4"
    >
      <h2 id="pledge-heading" className="font-heading text-lg font-semibold text-foreground">
        Votre promesse
      </h2>
      <p
        role="note"
        className="rounded-md border border-border bg-muted/40 px-3 py-2 text-sm text-foreground"
      >
        {PLEDGE_NON_COMMITMENT}
      </p>

      {pledge && !editing && (
        <div role="status" className="flex flex-col gap-1 text-sm text-foreground">
          <p className="font-medium">
            Intention {PLEDGE_INTENTION_LABELS[pledge.intention].toLowerCase()} —{' '}
            {formatAmount(pledge.amountEur)}
          </p>
          {pledge.comment && (
            <p className="whitespace-pre-line wrap-anywhere text-muted-foreground">
              {pledge.comment}
            </p>
          )}
          <p>
            Le porteur voit {shownToOwner(pledge)}, en plus du nombre et du total des promesses.
          </p>
          <p className="text-xs text-muted-foreground">
            Promesse faite le {dateFr(pledge.pledgedAt)}
            {changedLater(pledge) ? `, modifiée le ${dateFr(pledge.updatedAt)}` : ''}.
          </p>
        </div>
      )}

      {archived && (
        <p
          role="note"
          className="rounded-md border border-border bg-muted/40 px-3 py-2 text-sm text-foreground"
        >
          {pledge
            ? 'Cette demande est archivée par son porteur : votre promesse est close, conservée telle quelle. Vous ne pouvez plus la modifier ni la retirer, mais vous pouvez toujours masquer votre nom ou votre montant.'
            : 'Cette demande est archivée par son porteur : elle ne reçoit plus de promesse.'}
        </p>
      )}

      {formOpen && (
        <form noValidate onSubmit={submit} className="flex flex-col gap-4">
          <fieldset
            className="flex flex-col gap-2"
            aria-describedby={errors.intention ? `${ids.intention}-error` : undefined}
          >
            <legend className="mb-1 text-sm font-medium text-foreground">Votre intention</legend>
            {PLEDGE_INTENTIONS.map((intention) => (
              <label key={intention} className="flex items-start gap-2 text-sm text-foreground">
                <input
                  type="radio"
                  name={`${ids.intention}-intention`}
                  className="mt-0.5 size-4 shrink-0 accent-foreground"
                  checked={draft.intention === intention}
                  disabled={busy}
                  onChange={() => set('intention', intention)}
                />
                <span className="min-w-0">
                  {PLEDGE_INTENTION_LABELS[intention]}
                  <span className="block text-xs text-muted-foreground">
                    {PLEDGE_INTENTION_HINTS[intention]}
                  </span>
                </span>
              </label>
            ))}
            {error('intention', ids.intention)}
          </fieldset>

          <div className="flex flex-col gap-1">
            <label htmlFor={ids.amount} className="text-sm font-medium text-foreground">
              Montant envisagé (€)
            </label>
            <Input
              id={ids.amount}
              className="h-11 sm:w-64"
              inputMode="numeric"
              autoComplete="off"
              value={draft.amount}
              disabled={busy}
              onChange={(e) => set('amount', e.target.value)}
              {...described('amountEur', ids.amount)}
            />
            {typeof parsedAmount === 'number' && (
              <p className="text-xs text-muted-foreground">{formatAmount(parsedAmount)}</p>
            )}
            {error('amountEur', ids.amount)}
          </div>

          <div className="flex flex-col gap-1">
            <label htmlFor={ids.comment} className="text-sm font-medium text-foreground">
              Commentaire (facultatif)
            </label>
            <Textarea
              id={ids.comment}
              rows={3}
              value={draft.comment}
              disabled={busy}
              onChange={(e) => set('comment', e.target.value)}
              {...described('comment', ids.comment)}
            />
            <p className="text-xs text-muted-foreground">
              Pour vous seul : ni le porteur ni personne d’autre ne le lit. Texte simple (
              {draft.comment.length}/{PLEDGE_LIMITS.comment}).
            </p>
            {error('comment', ids.comment)}
          </div>

          <fieldset className="flex flex-col gap-2">
            <legend className="mb-1 text-sm font-medium text-foreground">
              Ce que voit le porteur
            </legend>
            <p className="text-xs text-muted-foreground">
              Il voit toujours le nombre de promesses et leur total — si vous êtes seul à promettre,
              le total révèle votre montant. Il ne voit jamais votre intention ni votre commentaire.
            </p>
            <label
              htmlFor={ids.showName}
              className="flex items-start gap-2 text-sm text-foreground"
            >
              <input
                id={ids.showName}
                type="checkbox"
                className="mt-0.5 size-4 shrink-0 accent-foreground"
                checked={draft.showName}
                disabled={busy}
                onChange={(e) => set('showName', e.target.checked)}
              />
              <span className="min-w-0 wrap-anywhere">Montrer mon nom : « {identity} »</span>
            </label>
            <label
              htmlFor={ids.showAmount}
              className="flex items-start gap-2 text-sm text-foreground"
            >
              <input
                id={ids.showAmount}
                type="checkbox"
                className="mt-0.5 size-4 shrink-0 accent-foreground"
                checked={draft.showAmount}
                disabled={busy}
                onChange={(e) => set('showAmount', e.target.checked)}
              />
              <span className="min-w-0">Montrer mon montant</span>
            </label>
          </fieldset>

          <div className="flex flex-wrap gap-2">
            <Button type="submit" className="min-h-11" disabled={busy}>
              {pledge === null ? 'Enregistrer ma promesse' : 'Enregistrer les modifications'}
            </Button>
            {pledge && (
              <Button
                type="button"
                variant="outline"
                className="min-h-11"
                disabled={busy}
                onClick={() => {
                  setDraft(draftOf(pledge))
                  setErrors({})
                  setEditing(false)
                }}
              >
                Annuler
              </Button>
            )}
          </div>
        </form>
      )}

      {pledge && !editing && (
        <div className="flex flex-wrap gap-2">
          {!archived ? (
            <>
              <Button
                type="button"
                variant="outline"
                className="min-h-11"
                disabled={busy}
                onClick={() => setEditing(true)}
              >
                Modifier ma promesse
              </Button>
              <Button
                type="button"
                variant="outline"
                className="min-h-11"
                disabled={busy}
                onClick={() =>
                  setConfirm({
                    title: 'Retirer votre promesse ?',
                    description:
                      'Le porteur ne la comptera plus. Vous pourrez en faire une nouvelle tant que la demande n’est pas close.',
                    confirmLabel: 'Retirer ma promesse',
                    onConfirm: () => void withdraw(),
                  })
                }
              >
                Retirer ma promesse
              </Button>
            </>
          ) : (
            <>
              {pledge.showName && (
                <Button
                  type="button"
                  variant="outline"
                  className="min-h-11"
                  disabled={busy}
                  onClick={() => hide('showName')}
                >
                  Masquer mon nom
                </Button>
              )}
              {pledge.showAmount && (
                <Button
                  type="button"
                  variant="outline"
                  className="min-h-11"
                  disabled={busy}
                  onClick={() => hide('showAmount')}
                >
                  Masquer mon montant
                </Button>
              )}
            </>
          )}
        </div>
      )}
      <ConfirmDialog request={confirm} onClose={() => setConfirm(null)} />
    </section>
  )
}
