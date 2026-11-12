import { useRef, useState } from 'react'
import { CircleUserRound } from 'lucide-react'
import type { CurrentUser } from '@confluent/shared'
import { Button } from '@/components/ui/button'
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from '@/components/ui/sheet'
import { LegalLinks } from '@/components/confluent/LegalLinks'
import { cn } from '@/lib/utils'
import { VersionBadge } from './VersionBadge'

// ROADMAP E10.07 (U01): on a phone or a tablet, where the sidebar is not shown, the account — its
// profile, the sign-out — and the legal information are one button away. A dialog: focus kept
// inside while open, given back to the button when closed.
export function AccountMenu({
  user,
  onEditProfile,
  onLogout,
  className,
}: {
  user: CurrentUser
  onEditProfile: (returnTo: HTMLElement | null) => void
  onLogout: () => void
  className?: string
}) {
  const [open, setOpen] = useState(false)
  const trigger = useRef<HTMLButtonElement>(null)
  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetTrigger
        render={
          <button
            ref={trigger}
            type="button"
            aria-label="Mon compte"
            title="Mon compte"
            className={cn(
              'inline-flex size-11 shrink-0 items-center justify-center rounded-md text-sidebar-foreground transition-colors hover:bg-sidebar-accent/60 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--ring)]',
              className,
            )}
          />
        }
      >
        <CircleUserRound className="size-6" aria-hidden="true" />
      </SheetTrigger>
      <SheetContent>
        <SheetHeader>
          <SheetTitle>Mon compte</SheetTitle>
          <SheetDescription className="wrap-anywhere">
            <span className="block font-medium text-foreground">{user.name}</span>
            <span className="block">{user.email}</span>
          </SheetDescription>
        </SheetHeader>
        <div className="flex flex-col gap-2 px-4">
          <Button
            type="button"
            variant="outline"
            size="lg"
            className="h-11"
            onClick={() => {
              setOpen(false)
              onEditProfile(trigger.current)
            }}
          >
            Modifier mon profil
          </Button>
          <Button type="button" variant="outline" size="lg" className="h-11" onClick={onLogout}>
            Se déconnecter
          </Button>
        </div>
        <div className="mt-auto flex flex-col gap-1 p-4">
          <LegalLinks className="text-sm" />
          <VersionBadge compact />
        </div>
      </SheetContent>
    </Sheet>
  )
}
