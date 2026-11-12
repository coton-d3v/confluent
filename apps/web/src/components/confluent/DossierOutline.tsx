import { sectionAnchor } from '@/lib/section-anchor'

// ROADMAP E10.07 (U08): the table of contents of a long dossier — a link to each of its sections,
// whose heading carries `sectionAnchor(id)`. Nothing for a single section.
export function DossierOutline({ sections }: { sections: ReadonlyArray<{ id: string; title: string }> }) {
  if (sections.length < 2) return null
  return (
    <nav aria-label="Sommaire du dossier" className="rounded-lg border border-border bg-card px-4 py-3">
      <p aria-hidden="true" className="text-sm font-medium text-foreground">
        Sommaire
      </p>
      <ol className="mt-1 flex flex-col text-sm">
        {sections.map((section, i) => (
          <li key={section.id}>
            <a
              href={`#${sectionAnchor(section.id)}`}
              className="inline-flex min-h-8 items-center rounded-sm text-muted-foreground underline-offset-4 hover:text-foreground hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--ring)] pointer-coarse:min-h-11"
            >
              {i + 1}. {section.title}
            </a>
          </li>
        ))}
      </ol>
    </nav>
  )
}
