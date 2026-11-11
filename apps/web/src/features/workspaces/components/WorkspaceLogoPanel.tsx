import { useRef, useState } from 'react'
import { ImageIcon } from 'lucide-react'
import { toast } from 'sonner'
import {
  WORKSPACE_LOGO_EXTENSIONS,
  WORKSPACE_LOGO_FORMATS_LABEL,
  WORKSPACE_LOGO_MAX_BYTES,
  WORKSPACE_LOGO_TYPES,
  type Workspace,
} from '@confluent/shared'
import { ConfirmDialog, type ConfirmRequest } from '@/components/confluent/ConfirmDialog'
import { Button } from '@/components/ui/button'
import { removeWorkspaceLogo, uploadWorkspaceLogo } from '@/features/admin/workspaces.api'
import type { ApiError } from '@/lib/api-client'

const ACCEPT = [...WORKSPACE_LOGO_TYPES, ...WORKSPACE_LOGO_EXTENSIONS.map((e) => `.${e}`)].join(',')

// Immediate feedback only: the API recognises the format from the content.
function localProblem(file: File): string | null {
  const extension = /\.([^.]+)$/.exec(file.name)?.[1]?.toLowerCase() ?? ''
  if (!(WORKSPACE_LOGO_EXTENSIONS as readonly string[]).includes(extension)) {
    return `Format de logo non accepté. Formats acceptés : ${WORKSPACE_LOGO_FORMATS_LABEL}.`
  }
  if (file.size > WORKSPACE_LOGO_MAX_BYTES) return 'Logo trop volumineux : 1 Mo maximum.'
  return null
}

// The workspace's logo: shown from its signed URL, sent, replaced or removed.
export function WorkspaceLogoPanel({
  workspace,
  onChange,
}: {
  workspace: Workspace
  onChange: (workspace: Workspace) => void
}) {
  const picker = useRef<HTMLInputElement>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [confirm, setConfirm] = useState<ConfirmRequest | null>(null)
  const logo = workspace.logo

  async function send(file: File) {
    const problem = localProblem(file)
    if (problem) {
      setError(problem)
      return
    }
    setBusy(true)
    setError(null)
    try {
      onChange(await uploadWorkspaceLogo(workspace.id, file))
      toast.success('Logo enregistré.')
    } catch (err) {
      setError((err as ApiError)?.message ?? 'Le logo n’a pas pu être enregistré.')
    } finally {
      setBusy(false)
      if (picker.current) picker.current.value = ''
    }
  }

  function askRemove() {
    setConfirm({
      title: 'Retirer le logo ?',
      description: 'L’image est supprimée du stockage. Vous pourrez en déposer une autre.',
      confirmLabel: 'Retirer le logo',
      onConfirm: () => {
        setBusy(true)
        setError(null)
        removeWorkspaceLogo(workspace.id)
          .then((updated) => {
            onChange(updated)
            toast.success('Logo retiré.')
          })
          .catch((err: ApiError) => setError(err?.message ?? 'Le logo n’a pas pu être retiré.'))
          .finally(() => setBusy(false))
      },
    })
  }

  return (
    <section aria-labelledby="ws-logo-title" className="flex flex-col gap-3">
      <h2 id="ws-logo-title" className="font-heading text-lg font-semibold text-foreground">
        Logo
      </h2>
      <div className="flex flex-wrap items-center gap-4">
        <div className="flex size-24 shrink-0 items-center justify-center overflow-hidden rounded-lg border border-border bg-muted">
          {logo?.url ? (
            <img
              src={logo.url}
              alt={`Logo de ${workspace.name}`}
              className="size-full object-contain p-1.5"
            />
          ) : (
            <ImageIcon aria-hidden="true" className="size-8 text-muted-foreground" />
          )}
        </div>
        <div className="flex min-w-0 flex-1 flex-col gap-2">
          <p className="text-sm text-muted-foreground">
            {logo === null
              ? 'Aucun logo.'
              : logo.availability === 'missing'
                ? 'L’image du logo est introuvable dans le stockage : déposez-la à nouveau.'
                : logo.availability === 'unavailable'
                  ? 'Le stockage est momentanément injoignable : le logo ne peut pas être affiché.'
                  : 'Logo en place.'}{' '}
            {WORKSPACE_LOGO_FORMATS_LABEL}, 1 Mo maximum.
          </p>
          <div className="flex flex-wrap gap-2">
            <Button
              type="button"
              size="sm"
              variant="outline"
              disabled={busy}
              onClick={() => picker.current?.click()}
            >
              {busy ? 'Envoi…' : logo ? 'Remplacer le logo' : 'Déposer un logo'}
            </Button>
            {logo && (
              <Button type="button" size="sm" variant="ghost" disabled={busy} onClick={askRemove}>
                Retirer le logo
              </Button>
            )}
          </div>
        </div>
      </div>
      <div aria-live="assertive">
        {error && (
          <p role="alert" className="text-sm text-destructive">
            {error}
          </p>
        )}
      </div>
      <input
        ref={picker}
        type="file"
        accept={ACCEPT}
        className="sr-only"
        tabIndex={-1}
        aria-hidden="true"
        onChange={(e) => {
          const file = e.target.files?.[0]
          if (file) void send(file)
        }}
      />
      <ConfirmDialog request={confirm} onClose={() => setConfirm(null)} />
    </section>
  )
}
