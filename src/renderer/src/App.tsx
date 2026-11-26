import { useState } from 'react'
import { useConnection, MISSING_CREDENTIALS } from './connection/ConnectionProvider'
import ConnectionBanner from './connection/ConnectionBanner'
import { useI18n } from './i18n/I18nProvider'
import Sidebar, { type Page } from './components/Sidebar'
import Dashboard from './pages/Dashboard'
import Invoices from './pages/Invoices'
import Suppliers from './pages/Suppliers'
import Reports from './pages/Reports'
import ImportPage from './pages/Import'
import Settings from './pages/Settings'
import { LOGO } from './assets/logo'

export default function App(): React.JSX.Element {
  const { status, error, retry } = useConnection()
  const { t } = useI18n()
  const [page, setPage] = useState<Page>('dashboard')
  const [reloadKey, setReloadKey] = useState(0) // changing it reloads the current page

  if (status === 'connecting') {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-4">
        <img src={LOGO} alt="" className="h-28 w-28 drop-shadow-lg" />
        <div className="text-xl font-bold text-slate-700">{t('appTitle')}</div>
        <div className="text-slate-500">{t('connecting')}</div>
      </div>
    )
  }

  if (status === 'error') {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3 p-6 text-center">
        <img src={LOGO} alt="" className="h-20 w-20" />
        <p className="text-lg font-semibold text-red-700">{t('connectionError')}</p>
        <p className="max-w-xl text-sm text-slate-600">
          {error === MISSING_CREDENTIALS ? t('missingCredentials') : error}
        </p>
        <button
          onClick={retry}
          className="rounded-md bg-blue-600 px-4 py-2 text-white hover:bg-blue-700"
        >
          {t('retry')}
        </button>
      </div>
    )
  }

  return (
    <div className="flex h-full">
      <Sidebar page={page} onNavigate={setPage} />
      <div className="flex min-w-0 flex-1 flex-col">
        <ConnectionBanner onReload={() => setReloadKey((k) => k + 1)} />
        <main key={reloadKey} className="flex-1 overflow-auto">
          {page === 'dashboard' && <Dashboard />}
          {page === 'invoices' && <Invoices />}
          {page === 'suppliers' && <Suppliers />}
          {page === 'reports' && <Reports />}
          {page === 'import' && <ImportPage onGoToInvoices={() => setPage('invoices')} />}
          {page === 'settings' && <Settings />}
        </main>
      </div>
    </div>
  )
}