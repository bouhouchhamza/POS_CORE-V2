import { useNavigate } from 'react-router-dom'
import { useAuth } from '../auth/useAuth'

type HeaderProps = {
  onMenuClick: () => void
  showMenu?: boolean
}

export default function Header({ onMenuClick, showMenu = true }: HeaderProps) {
  const navigate = useNavigate()
  const { logoutUser, user } = useAuth()

  async function handleLogout() {
    await logoutUser()
    navigate('/login', { replace: true })
  }

  return (
    <header className="header">
      {showMenu ? (
        <button
          aria-label="Ouvrir le menu"
          className="menu-button"
          type="button"
          onClick={onMenuClick}
        >
          <span />
          <span />
          <span />
        </button>
      ) : null}

      <div className="header-title">
        <p className="header-kicker">Gestion café</p>
        <h1>Bimik_Cafe</h1>
      </div>

      <div className="header-actions">
        <span className="user-chip">
          {user?.name ?? 'Utilisateur'}
          <small>{user?.role === 'patron' ? 'Patron/Admin' : 'Worker'}</small>
        </span>
        <button className="button secondary" type="button" onClick={handleLogout}>
          Logout
        </button>
      </div>
    </header>
  )
}
