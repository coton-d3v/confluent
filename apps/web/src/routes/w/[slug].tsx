import { useParams } from 'react-router-dom'
import { PublicShell } from '@/components/confluent/PublicShell'
import { Button } from '@/components/ui/button'
import { getPublicWorkspacePage, publicLogoUrl } from '@/features/workspace-pages/api'
import { PublicWorkspaceContent } from '@/features/workspace-pages/components/PublicWorkspaceContent'
import type { ApiError } from '@/lib/api-client'
import { useAsync } from '@/lib/useAsync'

// ROADMAP E09.01: a workspace's public page, signed in or not, once its managers published it. An
// unknown address and an unpublished page read alike. Not indexed by search engines.
export default function PublicWorkspaceRoute() {
  const { slug = '' } = useParams()
  return <PublicWorkspace key={slug} slug={slug} />
}

function PublicWorkspace({ slug }: { slug: string }) {
  const loaded = useAsync(() => getPublicWorkspacePage(slug), [slug])

  if (loaded.error) {
    const notFound = (loaded.error as ApiError).status === 404
    return (
      <PublicShell title="Page introuvable">
        <h1 className="font-heading text-2xl font-medium text-foreground">
          {notFound ? 'Page introuvable' : 'Page indisponible'}
        </h1>
        <p
          role="alert"
          className="rounded-lg border border-border bg-card p-4 text-sm text-foreground"
        >
          {notFound
            ? 'Aucune page publique à cette adresse. Vérifiez le lien reçu, ou contactez la structure qui vous l’a donné.'
            : 'La page est indisponible pour le moment. Réessayez dans quelques instants.'}
        </p>
        {!notFound && (
          <Button type="button" variant="outline" className="self-start" onClick={loaded.refetch}>
            Réessayer
          </Button>
        )}
      </PublicShell>
    )
  }
  if (!loaded.data) {
    return (
      <PublicShell title="Chargement">
        <p className="text-sm text-muted-foreground">Chargement…</p>
      </PublicShell>
    )
  }

  const page = loaded.data
  const { workspace } = page
  return (
    <PublicShell title={workspace.programName ?? workspace.name}>
      <PublicWorkspaceContent
        page={page}
        logoSrc={workspace.logoVersion ? publicLogoUrl(workspace.slug, workspace.logoVersion) : null}
      />
    </PublicShell>
  )
}
