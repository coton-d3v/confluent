import { Link } from 'react-router-dom'
import { cn } from '@/lib/utils'

const LINK_CLASS =
  'underline-offset-4 hover:text-foreground hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--ring)]'

export function LegalLinks({ className }: { className?: string }) {
  return (
    <nav
      aria-label="Informations légales"
      className={cn('flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground', className)}
    >
      <Link to="/mentions-legales" className={LINK_CLASS}>
        Mentions légales
      </Link>
      <Link to="/confidentialite" className={LINK_CLASS}>
        Confidentialité
      </Link>
    </nav>
  )
}
