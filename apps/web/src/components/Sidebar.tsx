import type { ReactNode } from 'react'
import {
  BarChart3,
  Boxes,
  ChefHat,
  ClipboardList,
  LayoutDashboard,
  Package,
  Settings,
  ShoppingBag,
  ShoppingCart,
  Tags,
  Truck,
  Users,
  Utensils,
  Warehouse,
} from 'lucide-react'
import { NavLink } from 'react-router-dom'
import { getNavItems } from '../auth/roles'
import { useAuth } from '../auth/useAuth'
import { useI18n } from '../i18n'

type SidebarProps = {
  isOpen: boolean
  onClose: () => void
}

const icons: Record<string, ReactNode> = {
  '/dashboard': <LayoutDashboard size={16} strokeWidth={2} />,
  '/pos': <ShoppingCart size={16} strokeWidth={2} />,
  '/tables': <Utensils size={16} strokeWidth={2} />,
  '/orders': <ClipboardList size={16} strokeWidth={2} />,
  '/kitchen': <ChefHat size={16} strokeWidth={2} />,
  '/products': <Package size={16} strokeWidth={2} />,
  '/categories': <Tags size={16} strokeWidth={2} />,
  '/stock': <Warehouse size={16} strokeWidth={2} />,
  '/suppliers': <Truck size={16} strokeWidth={2} />,
  '/purchases': <ShoppingBag size={16} strokeWidth={2} />,
  '/customers': <Users size={16} strokeWidth={2} />,
  '/rapport': <BarChart3 size={16} strokeWidth={2} />,
  '/settings': <Settings size={16} strokeWidth={2} />,
}

export default function Sidebar({ isOpen, onClose }: SidebarProps) {
  const { user } = useAuth()
  const hospitality = ['cafe', 'restaurant'].includes(user?.business?.business_type ?? '')
  const navItems = getNavItems(
    user?.role,
    user?.business?.enabled_features,
  )
  const { t } = useI18n()

  const labels: Record<string, string> = {
    '/dashboard': 'nav.dashboard',
    '/products': 'nav.products',
    '/categories': 'nav.categories',
    '/pos': hospitality ? 'nav.newOrder' : 'nav.cash',
    '/tables': 'nav.tables',
    '/orders': 'nav.orders',
    '/kitchen': 'nav.kitchen',
    '/stock': 'nav.stock',
    '/suppliers': 'nav.suppliers',
    '/purchases': 'nav.purchases',
    '/customers': 'nav.customers',
    '/rapport': 'nav.report',
    '/settings': 'nav.settings',
  }

  return (
    <>
      <aside className={`sidebar ${isOpen ? 'sidebar-open' : ''}`}>
        <div className="brand">
          <span className="brand-mark">BP</span>
          <div>
            <strong>Bimik POS</strong>
            <small>
              {user?.business?.name ?? t('brand.subtitle')}
            </small>
          </div>
        </div>

        <nav className="nav-links" aria-label={t('sidebar.navigation')}>
          {Array.isArray(navItems) &&
            navItems.map((item) => (
              <NavLink
                key={item.to}
                to={item.to}
                onClick={onClose}
                className={({ isActive }) =>
                  isActive ? 'active' : undefined
                }
              >
                <span className="nav-icon" aria-hidden="true">
                  {icons[item.to] ?? (
                    <Boxes size={16} strokeWidth={2} />
                  )}
                </span>
                <span>{t(labels[item.to] ?? item.label)}</span>
              </NavLink>
            ))}
        </nav>
      </aside>

      {isOpen ? (
        <button
          aria-label={t('sidebar.closeMenu')}
          className="mobile-backdrop"
          onClick={onClose}
          type="button"
        />
      ) : null}
    </>
  )
}
