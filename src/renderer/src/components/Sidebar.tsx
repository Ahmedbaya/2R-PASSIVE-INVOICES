import { useI18n } from '../i18n/I18nProvider'
import LanguageSwitcher from '../i18n/LanguageSwitcher'
import type { Dictionary } from '../i18n/translations'

export type Page = 'dashboard' | 'invoices' | 'suppliers' | 'reports' | 'import'

const ITEMS: { page: Page; label: keyof Dictionary }[] = [
  { page: 'dashboard', label: 'dashboard' },
  { page: 'invoices', label: 'invoices' },
  { page: 'suppliers', label: 'suppliers' },
  { page: 'reports', label: 'reports' },
  { page: 'import', label: 'importExcel' }
]

interface Props {
  page: Page
  onNavigate: (page: Page) => void
}

export default function Sidebar({ page, onNavigate }: Props): React.JSX.Element {
  const { t } = useI18n()
  return (
    <aside className="flex w-56 shrink-0 flex-col bg-slate-800 text-white">
      <div className="px-5 py-5 text-lg font-bold leading-tight">{t('appTitle')}</div>
      <nav className="flex-1 space-y-1 px-3">
        {ITEMS.map((item) => (
          <button
            key={item.page}
            onClick={() => onNavigate(item.page)}
            className={`block w-full rounded-md px-3 py-2 text-left text-sm ${
              page === item.page ? 'bg-slate-600 font-semibold' : 'hover:bg-slate-700'
            }`}
          >
            {t(item.label)}
          </button>
        ))}
      </nav>
      <div className="p-4">
        <LanguageSwitcher />
      </div>
    </aside>
  )
}