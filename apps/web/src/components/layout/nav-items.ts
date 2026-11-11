import {
  Building2,
  ClipboardList,
  FolderOpen,
  LayoutDashboard,
  Plug,
  Tags,
  Users,
  type LucideIcon,
} from 'lucide-react'

export interface NavItemSpec {
  to: string
  label: string
  icon: LucideIcon
  end?: boolean
}

export const NAV_ITEMS: NavItemSpec[] = [
  { to: '/dashboard', label: 'Mes dossiers', icon: FolderOpen, end: true },
  { to: '/dashboard/tableau-de-bord', label: 'Tableau de bord', icon: LayoutDashboard },
  { to: '/dashboard/applications', label: 'Applications IA', icon: Plug },
]

// Shown to an account that belongs to at least one workspace (E05.02); administrators reach all
// workspaces from the administration menu.
export const MY_WORKSPACES_NAV_ITEM: NavItemSpec = {
  to: '/workspaces',
  label: 'Mes workspaces',
  icon: Building2,
}

export const ADMIN_NAV_ITEMS: NavItemSpec[] = [
  { to: '/admin', label: 'Pipeline', icon: LayoutDashboard, end: true },
  { to: '/admin/dossiers', label: 'Dossiers', icon: FolderOpen },
  { to: '/admin/formulaires', label: 'Formulaires', icon: ClipboardList },
  { to: '/admin/classification', label: 'Classification', icon: Tags },
  { to: '/admin/utilisateurs', label: 'Utilisateurs', icon: Users },
  { to: '/admin/workspaces', label: 'Workspaces', icon: Building2 },
  { to: '/dashboard/applications', label: 'Applications IA', icon: Plug },
]
