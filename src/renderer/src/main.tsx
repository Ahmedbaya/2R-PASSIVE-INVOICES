import './index.css'
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App'
import { I18nProvider } from './i18n/I18nProvider'
import { ConnectionProvider } from './connection/ConnectionProvider'

// A file dropped outside a drop zone must not navigate the window to that file
window.addEventListener('dragover', (e) => e.preventDefault())
window.addEventListener('drop', (e) => e.preventDefault())

createRoot(document.getElementById('root') as HTMLElement).render(
  <StrictMode>
    <I18nProvider>
      <ConnectionProvider>
        <App />
      </ConnectionProvider>
    </I18nProvider>
  </StrictMode>
)