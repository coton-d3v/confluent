import { useCallback, useMemo, useRef, useState } from 'react'
import { Navigate, Outlet, useNavigate } from 'react-router-dom'
import { LoaderCircleIcon } from 'lucide-react'
import { Separator } from '@/components/ui/separator'
import { cn } from '@/lib/utils'
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
import type { ApiError } from '@/lib/api-client'
import { setAuth, getAuthState } from '@/features/auth/auth-store'
import { Breadcrumbs } from './Breadcrumbs'
import { NavItem } from './NavItem'
import { AccountMenu } from './AccountMenu'
import { useRouteFocus } from './useRouteFocus'
import { VersionBadge } from './VersionBadge'
import { LegalLinks } from '@/components/confluent/LegalLinks'
import { ServerUnreachable } from '@/components/confluent/ServerUnreachable'
import { useMyWorkspaceMemberships } from '@/features/workspaces/useMyWorkspaceMemberships'
import { WorkspaceMembershipsContext } from '@/features/workspaces/memberships-context'
import { WorkspaceSwitcher } from '@/features/workspaces/components/WorkspaceSwitcher'
import { NotificationBell } from '@/features/notifications/NotificationBell'
import { UnreadNotificationsContext } from '@/features/notifications/unread-context'
import { useUnreadCount } from '@/features/notifications/useUnreadCount'
import {
  ADMIN_NAV_ITEMS,
  MY_WORKSPACES_NAV_ITEM,
  NAV_ITEMS,
  OPPORTUNITIES_NAV_ITEM,
  POSITIONS_NAV_ITEM,
  type NavItemSpec,
} from './nav-items'
import type { CurrentUser } from '@confluent/shared'

// updateProfileSchema of @confluent/shared.
const PROFILE_NAME_MAX = 100

function profileFailure(err: unknown): string {
  const status = (err as Partial<ApiError> | undefined)?.status
  if (status === undefined) {
    return 'Vos informations n’ont pas été enregistrées : le serveur ne répond pas. Vérifiez votre connexion internet, puis réessayez.'
  }
  if (status === 400) {
    return `Vos informations n’ont pas été enregistrées : le prénom et le nom sont requis, ${PROFILE_NAME_MAX} caractères au plus chacun.`
  }
  if (status === 401) return 'Votre session a expiré : reconnectez-vous pour enregistrer vos informations.'
  return 'Vos informations n’ont pas été enregistrées : le serveur est momentanément indisponible. Réessayez dans quelques instants.'
}

function ProfileSheet({
  open,
  onOpenChange,
  required,
  currentFirstName,
  currentLastName,
  returnFocus,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  required: boolean
  currentFirstName: string
  currentLastName: string
  // Where the focus goes back when it closes (it has no trigger of its own).
  returnFocus: React.RefObject<HTMLElement | null>
}) {
  const [firstName, setFirstName] = useState(currentFirstName)
  const [lastName, setLastName] = useState(currentLastName)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const savingRef = useRef(false)

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (savingRef.current || !firstName.trim() || !lastName.trim()) return
    savingRef.current = true
    setSaving(true)
    setError(null)
    try {
      await updateProfile(firstName.trim(), lastName.trim())
      onOpenChange(false)
    } catch (err) {
      // E10.07 (U04): said in French, what was typed stays in the fields.
      setError(profileFailure(err))
    } finally {
      savingRef.current = false
      setSaving(false)
    }
  }

  return (
    <Sheet
      open={open}
      onOpenChange={
        required
          ? undefined
          : (next) => {
              if (!next) setError(null)
              onOpenChange(next)
            }
      }
    >
      <SheetContent showCloseButton={!required} finalFocus={returnFocus}>
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
              maxLength={PROFILE_NAME_MAX}
              autoComplete="given-name"
              aria-describedby={error ? 'profile-error' : undefined}
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
              maxLength={PROFILE_NAME_MAX}
              autoComplete="family-name"
              aria-describedby={error ? 'profile-error' : undefined}
            />
          </div>
          <div aria-live="assertive" aria-atomic="true">
            {error && (
              <p id="profile-error" className="text-sm text-destructive">
                {error}
              </p>
            )}
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
  onEditProfile: (returnTo?: HTMLElement | null) => void
}) {
  return (
    <aside className="hidden w-60 shrink-0 flex-col bg-sidebar lg:flex">
      <div className="flex items-center justify-between py-3 pr-2 pl-4">
        <div className="text-lg font-heading font-medium text-sidebar-foreground">Confluent</div>
        <NotificationBell />
      </div>
      <WorkspaceSwitcher className="px-4 pb-4" />
      <Separator />
      <nav aria-label="Navigation principale" className="flex-1 px-2 py-4">
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
          onClick={(e) => onEditProfile(e.currentTarget)}
          className="mb-3 w-full rounded-md px-1 py-1 text-left transition-colors hover:bg-sidebar-accent focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--ring)]"
        >
          <div className="truncate font-medium text-sidebar-foreground" title={user.name}>
            {user.name}
          </div>
          <div className="truncate text-xs text-muted-foreground" title={user.email}>
            {user.email}
          </div>
        </button>
        <Button type="button" variant="outline" size="sm" className="w-full" onClick={onLogout}>
          Se déconnecter
        </Button>
      </div>
      <LegalLinks className="px-4 pt-2" />
      <VersionBadge />
    </aside>
  )
}

function TabletRail({
  user,
  navItems,
  onLogout,
  onEditProfile,
}: {
  user: CurrentUser
  navItems: NavItemSpec[]
  onLogout: () => void
  onEditProfile: (returnTo?: HTMLElement | null) => void
}) {
  return (
    <aside className="hidden w-[60px] shrink-0 flex-col items-center bg-sidebar md:flex lg:hidden">
      <div
        className="py-6 text-lg font-heading font-medium text-sidebar-foreground"
        aria-hidden="true"
      >
        C
      </div>
      <NotificationBell className="mb-2" />
      <Separator />
      <nav aria-label="Navigation principale" className="flex-1 py-4">
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
        <AccountMenu user={user} onLogout={onLogout} onEditProfile={onEditProfile} />
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
  const { user, loading, unreachable, retry } = useAuthState()
  const navigate = useNavigate()
  // Derived, not initial state: during the session restore `user` is still null, and a useState
  // seeded then would keep the onboarding sheet open on every page reload.
  const needsOnboarding = !!user && !user.firstName
  // Only the voluntary "edit my profile" opening is local state.
  const [editingProfile, setEditingProfile] = useState(false)
  const profileReturn = useRef<HTMLElement | null>(null)
  // E10.07: closing the profile gives the focus back to what opened it.
  const editProfile = useCallback((returnTo?: HTMLElement | null) => {
    profileReturn.current = returnTo ?? (document.activeElement as HTMLElement | null)
    setEditingProfile(true)
  }, [])
  // Every account's memberships: the workspaces it can switch between (an administrator may be a
  // member too); none for most accounts, whose journeys stay as they were.
  const memberships = useMyWorkspaceMemberships(user ? user.id : null)
  const workspaceMemberships = useMemo(
    () => ({ memberships: memberships.data ?? [], refresh: memberships.refetch }),
    [memberships.data, memberships.refetch],
  )
  // E10.03: the bell's count, kept here for every page.
  const unread = useUnreadCount(user ? user.id : null)
  const unreadNotifications = useMemo(
    () => ({ count: unread.count, refresh: unread.refresh }),
    [unread.count, unread.refresh],
  )
  useRouteFocus('main-content')

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <LoaderCircleIcon className="size-8 animate-spin text-muted-foreground" />
      </div>
    )
  }

  // E10.06: no answer from the server is not a sign-out: the sign-in page would not be the way back.
  if (!user && unreachable) return <ServerUnreachable onRetry={retry} />
  if (!user) {
    return <Navigate to="/auth" replace />
  }

  const baseNavItems =
    user.role === 'admin'
      ? ADMIN_NAV_ITEMS
      : memberships.data?.length
        ? [...NAV_ITEMS, MY_WORKSPACES_NAV_ITEM]
        : NAV_ITEMS
  const readsOpportunities =
    user.role === 'financeur' || (memberships.data ?? []).some((m) => m.role === 'investisseur')
  const navItems = readsOpportunities
    ? [baseNavItems[0], OPPORTUNITIES_NAV_ITEM, POSITIONS_NAV_ITEM, ...baseNavItems.slice(1)]
    : baseNavItems

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
    <WorkspaceMembershipsContext value={workspaceMemberships}>
      <UnreadNotificationsContext value={unreadNotifications}>
        <div className="flex min-h-screen bg-background">
          <SkipLink />
          <DesktopSidebar
            user={user}
            navItems={navItems}
            onLogout={handleLogout}
            onEditProfile={editProfile}
          />
          <TabletRail
            user={user}
            navItems={navItems}
            onLogout={handleLogout}
            onEditProfile={editProfile}
          />
          <ProfileSheet
            open={needsOnboarding || editingProfile}
            onOpenChange={setEditingProfile}
            required={needsOnboarding}
            currentFirstName={currentFirstName}
            currentLastName={currentLastName}
            returnFocus={profileReturn}
          />
          <main
            id="main-content"
            tabIndex={-1}
            className="min-w-0 flex-1 px-4 py-6 pb-24 sm:px-6 sm:py-8 md:pb-8"
          >
            <div
              className={cn(
                'mb-6 flex items-start justify-between gap-3',
                memberships.data?.length ? 'lg:hidden' : 'md:hidden',
              )}
            >
              <WorkspaceSwitcher className="max-w-sm min-w-0 flex-1" />
              <div className="-mt-1 ml-auto flex shrink-0 items-center md:hidden">
                <NotificationBell />
                <AccountMenu
                  user={user}
                  onLogout={handleLogout}
                  onEditProfile={editProfile}
                />
              </div>
            </div>
            <Breadcrumbs />
            <Outlet />
          </main>
          <MobileBottomNav navItems={navItems} />
        </div>
      </UnreadNotificationsContext>
    </WorkspaceMembershipsContext>
  )
}
