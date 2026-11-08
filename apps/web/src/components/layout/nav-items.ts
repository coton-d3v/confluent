import {
  ClipboardList,
  FolderOpen,
  LayoutDashboard,
  Plug,
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

export const ADMIN_NAV_ITEMS: NavItemSpec[] = [
  { to: '/admin', label: 'Pipeline', icon: LayoutDashboard, end: true },
  { to: '/admin/dossiers', label: 'Dossiers', icon: FolderOpen },
  { to: '/admin/formulaires', label: 'Formulaires', icon: ClipboardList },
  { to: '/admin/utilisateurs', label: 'Utilisateurs', icon: Users },
  { to: '/dashboard/applications', label: 'Applications IA', icon: Plug },
]
