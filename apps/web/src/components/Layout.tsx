import { useState } from 'react'
import { Outlet } from 'react-router-dom'
import Header from './Header'
import Sidebar from './Sidebar'

export default function Layout() {
  const [isMenuOpen, setIsMenuOpen] = useState(false)

  return (
    <div className="app-shell">
      <Sidebar isOpen={isMenuOpen} onClose={() => setIsMenuOpen(false)} />

      <div className="main-shell">
        <Header onMenuClick={() => setIsMenuOpen(true)} />
        <main className="page-container">
          <Outlet />
        </main>
      </div>
    </div>
  )
}
