import { useRef, useState } from 'react'
import { Navigate, Outlet, useNavigate } from 'react-router-dom'
import { LoaderCircleIcon } from 'lucide-react'
import { Separator } from '@/components/ui/separator'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
  SheetFooter,
} from '@/components/ui/sheet'
import { useAuthState } from '@/features/current-user/context'
import { logout, updateProfile } from '@/features/auth/api'
import { setAuth, getAuthState } from '@/features/auth/auth-store'
import { Breadcrumbs } from './Breadcrumbs'
import { NavItem } from './NavItem'
import { VersionBadge } from './VersionBadge'
import { LegalLinks } from '@/components/confluent/LegalLinks'
import { ADMIN_NAV_ITEMS, NAV_ITEMS, type NavItemSpec } from './nav-items'
import type { CurrentUser } from '@confluent/shared'

function ProfileSheet({
  open,
  onOpenChange,
  required,
  currentFirstName,
  currentLastName,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  required: boolean
  currentFirstName: string
  currentLastName: string
}) {
  const [firstName, setFirstName] = useState(currentFirstName)
  const [lastName, setLastName] = useState(currentLastName)
  const [saving, setSaving] = useState(false)
  const savingRef = useRef(false)

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (savingRef.current || !firstName.trim() || !lastName.trim()) return
    savingRef.current = true
    setSaving(true)
    try {
      await updateProfile(firstName.trim(), lastName.trim())
      onOpenChange(false)
    } finally {
      savingRef.current = false
      setSaving(false)
    }
  }

  return (
    <Sheet open={open} onOpenChange={required ? undefined : onOpenChange}>
      <SheetContent showCloseButton={!required}>
        <SheetHeader>
          <SheetTitle>{required ? 'Bienvenue sur Confluent' : 'Mon profil'}</SheetTitle>
          <SheetDescription>
            {required
              ? 'Renseignez votre prénom et votre nom pour accéder à la plateforme.'
              : 'Modifiez vos informations personnelles.'}
          </SheetDescription>
        </SheetHeader>
        <form onSubmit={handleSubmit} className="flex flex-col gap-4 px-4">
          <div className="flex flex-col gap-1.5">
            <label htmlFor="profile-firstname" className="text-sm font-medium text-foreground">
              Prénom
            </label>
            <Input
              id="profile-firstname"
              value={firstName}
              onChange={(e) => setFirstName(e.target.value)}
              placeholder="Sophie"
              required
              autoFocus
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <label htmlFor="profile-lastname" className="text-sm font-medium text-foreground">
              Nom
            </label>
            <Input
              id="profile-lastname"
              value={lastName}
              onChange={(e) => setLastName(e.target.value)}
              placeholder="Moreau"
              required
            />
          </div>
        </form>
        <SheetFooter>
          <Button
            type="submit"
            size="lg"
            className="w-full"
            disabled={saving || !firstName.trim() || !lastName.trim()}
            onClick={handleSubmit}
          >
            {saving ? 'Enregistrement…' : 'Enregistrer'}
          </Button>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  )
}

function SkipLink() {
  return (
    <a
      href="#main-content"
      className="sr-only focus:not-sr-only focus:absolute focus:top-2 focus:left-2 focus:z-50 focus:rounded-md focus:bg-background focus:px-3 focus:py-2 focus:text-sm focus:font-medium focus:shadow focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--ring)]"
    >
      Aller au contenu principal
    </a>
  )
}

function DesktopSidebar({
  user,
  navItems,
  onLogout,
  onEditProfile,
}: {
  user: CurrentUser
  navItems: NavItemSpec[]
  onLogout: () => void
  onEditProfile: () => void
}) {
  return (
    <aside className="hidden w-60 shrink-0 flex-col bg-sidebar lg:flex">
      <div className="px-4 py-6 text-lg font-heading font-medium text-sidebar-foreground">
        Confluent
      </div>
      <Separator />
      <nav
        aria-label="Navigation principale"
        className="flex-1 px-2 py-4"
      >
        <ul className="space-y-1">
          {navItems.map((item) => (
            <li key={item.to}>
              <NavItem item={item} variant="desktop" />
            </li>
          ))}
        </ul>
      </nav>
      <Separator />
      <div className="px-4 py-4 text-sm">
        <button
          type="button"
          onClick={onEditProfile}
          className="mb-3 w-full rounded-md px-1 py-1 text-left transition-colors hover:bg-sidebar-accent focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--ring)]"
        >
          <div className="truncate font-medium text-sidebar-foreground" title={user.name}>
            {user.name}
          </div>
          <div className="truncate text-xs text-muted-foreground" title={user.email}>
            {user.email}
          </div>
        </button>
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="w-full"
          onClick={onLogout}
        >
          Se déconnecter
        </Button>
      </div>
      <LegalLinks className="px-4 pt-2" />
      <VersionBadge />
    </aside>
  )
}

function TabletRail({ user, navItems }: { user: CurrentUser; navItems: NavItemSpec[] }) {
  const initial = (user.name.charAt(0) || '?').toUpperCase()
  return (
    <aside className="hidden w-[60px] shrink-0 flex-col items-center bg-sidebar md:flex lg:hidden">
      <div
        className="py-6 text-lg font-heading font-medium text-sidebar-foreground"
        aria-hidden="true"
      >
        C
      </div>
      <Separator />
      <nav
        aria-label="Navigation principale"
        className="flex-1 py-4"
      >
        <ul className="flex flex-col items-center gap-1">
          {navItems.map((item) => (
            <li key={item.to}>
              <NavItem item={item} variant="rail" />
            </li>
          ))}
        </ul>
      </nav>
      <Separator />
      <div className="py-4">
        <div
          role="img"
          title={user.name}
          aria-label={user.name}
          className="flex size-8 items-center justify-center rounded-full bg-muted text-xs font-medium text-muted-foreground"
        >
          {initial}
        </div>
      </div>
    </aside>
  )
}

function MobileBottomNav({ navItems }: { navItems: NavItemSpec[] }) {
  return (
    <nav
      aria-label="Navigation principale"
      className="fixed inset-x-0 bottom-0 z-40 flex h-16 border-t border-sidebar-border bg-sidebar md:hidden"
    >
      <ul className="flex w-full">
        {navItems.map((item) => (
          <li key={item.to} className="flex min-h-11 flex-1">
            <NavItem item={item} variant="bottom" />
          </li>
        ))}
      </ul>
    </nav>
  )
}

export function AppShell() {
  const { user, loading } = useAuthState()
  const navigate = useNavigate()
  const needsOnboarding = !user?.firstName
  const [profileOpen, setProfileOpen] = useState(needsOnboarding)

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <LoaderCircleIcon className="size-8 animate-spin text-muted-foreground" />
      </div>
    )
  }

  if (!user) {
    return <Navigate to="/auth" replace />
  }

  const navItems = user.role === 'admin' ? ADMIN_NAV_ITEMS : NAV_ITEMS

  async function handleLogout() {
    try {
      await logout()
    } catch {
      // ignore — clear local state regardless
    }
    setAuth(null)
    navigate('/auth', { replace: true })
  }

  const authUser = getAuthState().user
  const currentFirstName = authUser?.firstName ?? ''
  const currentLastName = authUser?.lastName ?? ''

  return (
    <div className="flex min-h-screen bg-background">
      <SkipLink />
      <DesktopSidebar user={user} navItems={navItems} onLogout={handleLogout} onEditProfile={() => setProfileOpen(true)} />
      <TabletRail user={user} navItems={navItems} />
      <ProfileSheet
        open={profileOpen}
        onOpenChange={setProfileOpen}
        required={needsOnboarding}
        currentFirstName={currentFirstName}
        currentLastName={currentLastName}
      />
      <main
        id="main-content"
        tabIndex={-1}
        className="flex-1 px-6 py-8 pb-16 md:pb-0 focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-[var(--ring)]"
      >
        <Breadcrumbs />
        <Outlet />
      </main>
      <MobileBottomNav navItems={navItems} />
    </div>
  )
}
