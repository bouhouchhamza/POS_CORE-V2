import { useState } from 'react'
import { Outlet } from 'react-router-dom'
import { useAuth } from '../auth/useAuth'
import Header from './Header'
import Sidebar from './Sidebar'

export default function Layout() {
  const [isMenuOpen, setIsMenuOpen] = useState(false)
  const { user } = useAuth()
  const isWorker = user?.role === 'worker'

  return (
    <div className={isWorker ? 'app-shell worker-shell' : 'app-shell'}>
      {!isWorker ? (
        <Sidebar isOpen={isMenuOpen} onClose={() => setIsMenuOpen(false)} />
      ) : null}

      <div className="main-shell">
        <Header onMenuClick={() => setIsMenuOpen(true)} showMenu={!isWorker} />
        <main className="page-container">
          <Outlet />
        </main>
      </div>
    </div>
  )
}
