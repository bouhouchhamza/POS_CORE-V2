import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import { AuthProvider } from './auth/AuthProvider.tsx'
import './index.css'
import App from './App.tsx'
import { I18nProvider } from './i18n/index.tsx'
import { installTouchKeyboard } from './utils/touchKeyboard.ts'

installTouchKeyboard()

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <BrowserRouter>
      <I18nProvider><AuthProvider><App /></AuthProvider></I18nProvider>
    </BrowserRouter>
  </StrictMode>,
)
