import { useEffect, useState } from 'react'
import { LogOut } from 'lucide-react'
import { useNavigate } from 'react-router-dom'
import { getCurrentCashRegister } from '../api/cash-register'
import { getLocalStatus, type LocalStatus } from '../api/local-status'
import { getRoleLabel } from '../auth/roles'
import { useAuth } from '../auth/useAuth'
import { useI18n, type Language } from '../i18n'

type HeaderProps = {
  onMenuClick: () => void
  showMenu?: boolean
}

export default function Header({
  onMenuClick,
  showMenu = true,
}: HeaderProps) {
  const navigate = useNavigate()
  const { logoutUser, user } = useAuth()
  const { language, setLanguage, t } = useI18n()
  const [registerOpen, setRegisterOpen] = useState<boolean | null>(null)
  const [localStatus, setLocalStatus] = useState<LocalStatus | null>(null)

  useEffect(() => {
    const refresh = () => {
      getCurrentCashRegister()
        .then((value) => setRegisterOpen(Boolean(value)))
        .catch(() => setRegisterOpen(null))
    }

    refresh()
    window.addEventListener('cash-register-changed', refresh)

    return () =>
      window.removeEventListener('cash-register-changed', refresh)
  }, [])

  useEffect(() => {
    if (!('__TAURI_INTERNALS__' in window)) {
      setLocalStatus(null)
      return
    }

    let active = true

    const refresh = () =>
      getLocalStatus()
        .then((value) => {
          if (active) setLocalStatus(value)
        })
        .catch(() => {
          if (active) setLocalStatus(null)
        })

    refresh()
    const timer = window.setInterval(refresh, 30_000)

    return () => {
      active = false
      window.clearInterval(timer)
    }
  }, [])

  async function handleLogout() {
    await logoutUser()
    navigate('/login', { replace: true })
  }

  const canOpenRegisterPage = [
    'patron',
    'owner',
    'admin',
    'manager',
    'worker',
    'cashier',
  ].includes(user?.role ?? '')

  const connectivityTitle = localStatus
    ? `${
        t(
          localStatus.internet === 'available'
            ? 'header.internetAvailable'
            : 'header.internetUnavailable',
        )
      } · ${
        t(
          localStatus.backup === 'success'
            ? 'header.backupSuccess'
            : localStatus.backup === 'error'
              ? 'header.backupError'
              : 'header.backupPending',
        )
      }`
    : ''

  return (
    <header className="header commercial-header">
      {showMenu ? (
        <button
          aria-label={t('header.openMenu')}
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
        <p className="header-kicker">Bimik POS</p>
        <h1>{user?.business?.name ?? t('brand.subtitle')}</h1>
      </div>

      <div className="header-actions commercial-header-actions">
        {localStatus ? (
          <span
            aria-label={connectivityTitle}
            className={`connectivity-indicator ${
              localStatus.internet === 'available' &&
              localStatus.backup !== 'error'
                ? 'online'
                : 'attention'
            }`}
            role="status"
            title={connectivityTitle}
          />
        ) : null}

        {canOpenRegisterPage ? (
          <button
            className={`register-status-button ${
              registerOpen ? 'open' : 'closed'
            }`}
            onClick={() => navigate('/sales')}
            type="button"
          >
            <span
              aria-hidden="true"
              className="register-status-dot"
            />
            <span>
              {t(
                registerOpen
                  ? 'header.registerOpen'
                  : 'header.registerClosed',
              )}
            </span>
          </button>
        ) : (
          <span
            className={`register-status-button static ${
              registerOpen ? 'open' : 'closed'
            }`}
          >
            <span
              aria-hidden="true"
              className="register-status-dot"
            />
            <span>
              {t(
                registerOpen
                  ? 'header.registerOpen'
                  : 'header.registerClosed',
              )}
            </span>
          </span>
        )}

        <label className="language-selector header-language-selector">
          <span className="sr-only">{t('language.label')}</span>
          <select
            aria-label={t('language.label')}
            value={language}
            onChange={(event) =>
              setLanguage(event.target.value as Language)
            }
          >
            <option value="fr">FR</option>
            <option value="en">EN</option>
            <option value="ar">AR</option>
          </select>
        </label>

        <span className="user-chip">
          {user?.name ?? t('header.user')}
          <small>{getRoleLabel(user?.role, language)}</small>
        </span>

        <button
          aria-label={t('header.logout')}
          className="button secondary header-logout-button"
          type="button"
          onClick={handleLogout}
        >
          <LogOut size={16} />
          <span className="header-logout-label">{t('header.logout')}</span>
        </button>
      </div>
    </header>
  )
}
