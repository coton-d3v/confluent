import { useEffect, useState } from 'react'
import { ArrowDownIcon, ArrowUpIcon, EyeIcon, EyeOffIcon } from 'lucide-react'
import { PUBLIC_PAGE_BLOCKS, type PublicPageBlock, type PublicPageContent } from '@confluent/shared'
import { Button } from '@/components/ui/button'

// ROADMAP E09.04: what each block of the public page shows (labels and help of the managers' editor).
const PAGE_BLOCK_LABELS: Record<PublicPageBlock, { label: string; help: string }> = {
  presentation: {
    label: 'Présentation',
    help: 'Le texte de présentation de l’onglet Réglages.',
  },
  criteria: { label: 'Critères', help: 'Les critères saisis ci-dessus.' },
  committees: {
    label: 'Prochains comités',
    help: 'Les sessions ouvertes aux demandes de participation (nom, date et heure), chacune avec un lien vers le formulaire.',
  },
  cards: {
    label: 'Projets accompagnés',
    help: 'Les cartes anonymes que les porteurs ont choisi d’afficher.',
  },
  apply: {
    label: 'Appel à candidater',
    help: 'Comment présenter une demande depuis un compte Confluent, et le formulaire de demande d’accès pour les porteurs sans compte, tant qu’un formulaire de candidature est publié.',
  },
  participate: {
    label: 'Appel à participer',
    help: 'Le lien vers le formulaire de demande de participation, tant que des sessions y sont ouvertes.',
  },
  contact: { label: 'Contact', help: 'Le contact public saisi ci-dessus.' },
}

// Whether a block would show something now (the texts as typed, the rest as the API read it).
function hasContent(
  block: PublicPageBlock,
  content: PublicPageContent,
  texts: { presentation: string | null; criteria: string | null; contact: string | null },
): boolean {
  switch (block) {
    case 'presentation':
    case 'criteria':
    case 'contact':
      return texts[block] !== null
    case 'committees':
    case 'participate':
      return content.committees.length > 0
    case 'cards':
      return content.cards.length > 0
    case 'apply':
      return content.receivesCandidatures
  }
}

// The blocks shown, in their order, each moved up or down, hidden or shown again by buttons — never
// by dragging alone —, the focus kept on the block moved and each move announced.
export function PageBlocksEditor({
  blocks,
  onChange,
  content,
  texts,
  disabled,
}: {
  blocks: PublicPageBlock[]
  onChange: (blocks: PublicPageBlock[]) => void
  content: PublicPageContent
  texts: { presentation: string | null; criteria: string | null; contact: string | null }
  disabled: boolean
}) {
  const hidden = PUBLIC_PAGE_BLOCKS.filter((block) => !blocks.includes(block))
  const [announcement, setAnnouncement] = useState('')
  // The control to focus once the list is drawn again.
  const [focus, setFocus] = useState<string | null>(null)

  useEffect(() => {
    if (focus) document.getElementById(focus)?.focus()
  }, [focus, blocks])

  function move(block: PublicPageBlock, by: -1 | 1) {
    const from = blocks.indexOf(block)
    const to = from + by
    if (from < 0 || to < 0 || to >= blocks.length) return
    const next = [...blocks]
    next.splice(from, 1)
    next.splice(to, 0, block)
    onChange(next)
    // At an end, the button pressed is disabled: the focus goes to the other one.
    const edge = to === 0 ? 'down' : to === next.length - 1 ? 'up' : null
    setFocus(controlId(block, edge ?? (by < 0 ? 'up' : 'down')))
    setAnnouncement(
      `« ${PAGE_BLOCK_LABELS[block].label} » en position ${to + 1} sur ${next.length}.`,
    )
  }

  function hide(block: PublicPageBlock) {
    onChange(blocks.filter((b) => b !== block))
    setFocus(controlId(block, 'show'))
    setAnnouncement(`« ${PAGE_BLOCK_LABELS[block].label} » masqué.`)
  }

  function show(block: PublicPageBlock) {
    const next = [...blocks, block]
    onChange(next)
    setFocus(controlId(block, 'hide'))
    setAnnouncement(
      `« ${PAGE_BLOCK_LABELS[block].label} » affiché, en position ${next.length} sur ${next.length}.`,
    )
  }

  return (
    <fieldset className="flex min-w-0 flex-col gap-3" aria-describedby="ws-page-blocks-help">
      <legend className="text-sm font-medium text-foreground">Blocs de la page</legend>
      <p id="ws-page-blocks-help" className="text-xs text-muted-foreground">
        L’en-tête (logo, nom, programme) est toujours affiché. Choisissez les blocs affichés dessous
        et leur ordre ; un bloc sans contenu n’apparaît pas.
      </p>

      <div className="flex flex-col gap-2">
        <h3 className="text-xs font-medium tracking-wide text-muted-foreground uppercase">
          Affichés, dans l’ordre
        </h3>
        {blocks.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            Aucun bloc : la page ne montre que son en-tête.
          </p>
        ) : (
          <ol className="flex flex-col gap-2">
            {blocks.map((block, i) => (
              <li
                key={block}
                className="flex min-w-0 flex-col gap-2 rounded-lg border border-border bg-card p-3 sm:flex-row sm:items-center"
              >
                <BlockText
                  block={block}
                  position={`${i + 1}.`}
                  empty={!hasContent(block, content, texts)}
                />
                <div className="flex shrink-0 gap-2">
                  <Button
                    id={controlId(block, 'up')}
                    type="button"
                    variant="outline"
                    className="size-11"
                    disabled={disabled || i === 0}
                    onClick={() => move(block, -1)}
                  >
                    <ArrowUpIcon aria-hidden="true" />
                    <span className="sr-only">Monter « {PAGE_BLOCK_LABELS[block].label} »</span>
                  </Button>
                  <Button
                    id={controlId(block, 'down')}
                    type="button"
                    variant="outline"
                    className="size-11"
                    disabled={disabled || i === blocks.length - 1}
                    onClick={() => move(block, 1)}
                  >
                    <ArrowDownIcon aria-hidden="true" />
                    <span className="sr-only">Descendre « {PAGE_BLOCK_LABELS[block].label} »</span>
                  </Button>
                  <Button
                    id={controlId(block, 'hide')}
                    type="button"
                    variant="outline"
                    className="h-11"
                    disabled={disabled}
                    onClick={() => hide(block)}
                  >
                    <EyeOffIcon aria-hidden="true" />
                    Masquer
                    <span className="sr-only"> « {PAGE_BLOCK_LABELS[block].label} »</span>
                  </Button>
                </div>
              </li>
            ))}
          </ol>
        )}
      </div>

      {hidden.length > 0 && (
        <div className="flex flex-col gap-2">
          <h3 className="text-xs font-medium tracking-wide text-muted-foreground uppercase">
            Masqués
          </h3>
          <ul className="flex flex-col gap-2">
            {hidden.map((block) => (
              <li
                key={block}
                className="flex min-w-0 flex-col gap-2 rounded-lg border border-dashed border-border p-3 sm:flex-row sm:items-center"
              >
                <BlockText block={block} empty={false} />
                <Button
                  id={controlId(block, 'show')}
                  type="button"
                  variant="outline"
                  className="h-11 shrink-0 self-start sm:self-auto"
                  disabled={disabled}
                  onClick={() => show(block)}
                >
                  <EyeIcon aria-hidden="true" />
                  Afficher
                  <span className="sr-only"> « {PAGE_BLOCK_LABELS[block].label} »</span>
                </Button>
              </li>
            ))}
          </ul>
        </div>
      )}

      <p aria-live="polite" className="sr-only">
        {announcement}
      </p>
    </fieldset>
  )
}

function BlockText({
  block,
  position,
  empty,
}: {
  block: PublicPageBlock
  position?: string
  empty: boolean
}) {
  const { label, help } = PAGE_BLOCK_LABELS[block]
  return (
    <div className="flex min-w-0 flex-1 flex-col gap-0.5">
      <p className="text-sm font-medium text-foreground">
        {position && <span className="mr-1 text-muted-foreground">{position}</span>}
        {label}
      </p>
      <p className="text-xs text-muted-foreground">{help}</p>
      {empty && (
        <p className="text-xs text-foreground">
          Rien à afficher pour l’instant : le bloc n’apparaît pas.
        </p>
      )}
    </div>
  )
}

function controlId(block: PublicPageBlock, control: 'up' | 'down' | 'hide' | 'show') {
  return `ws-page-block-${block}-${control}`
}
