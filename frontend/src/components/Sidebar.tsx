import { NavLink } from 'react-router-dom'
import { getNavItems } from '../auth/roles'
import { useAuth } from '../auth/useAuth'

type SidebarProps = {
  isOpen: boolean
  onClose: () => void
}

export default function Sidebar({ isOpen, onClose }: SidebarProps) {
  const { user } = useAuth()
  const navItems = getNavItems(user?.role)

  return (
    <>
      <aside className={`sidebar ${isOpen ? 'sidebar-open' : ''}`}>
        <div className="brand">
          <span className="brand-mark">BC</span>
          <div>
            <strong>Bimik_Cafe</strong>
            <small>Stock & caisse</small>
          </div>
        </div>

        <nav className="nav-links" aria-label="Navigation principale">
          {Array.isArray(navItems) && navItems.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              onClick={onClose}
              className={({ isActive }) => (isActive ? 'active' : undefined)}
            >
              <span className="nav-icon" aria-hidden="true">
                {item.label.slice(0, 2)}
              </span>
              <span>{item.label}</span>
            </NavLink>
          ))}
        </nav>
      </aside>

      {isOpen ? (
        <button
          aria-label="Fermer le menu"
          className="mobile-backdrop"
          onClick={onClose}
          type="button"
        />
      ) : null}
    </>
  )
}
