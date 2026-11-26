import { useEffect, useState, type FormEvent, type ReactNode } from 'react'
import { useI18n } from '../i18n/I18nProvider'
import { LANGUAGES, type Lang } from '../i18n/translations'
import {
  EMPTY_COMPANY,
  fetchCompany,
  loadExportLang,
  saveCompany,
  saveExportLang,
  type Company
} from '../lib/settings'
import { LOGO } from '../assets/logo'

const inputCls =
  'w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm outline-none focus:border-blue-500'

function Field({ label, children }: { label: string; children: ReactNode }): React.JSX.Element {
  return (
    <label className="block">
      <span className="mb-1 block text-sm font-medium text-slate-700">{label}</span>
      {children}
    </label>
  )
}

function LangButtons({
  value,
  onChange
}: {
  value: Lang
  onChange: (lang: Lang) => void
}): React.JSX.Element {
  return (
    <div className="inline-flex overflow-hidden rounded-md border border-slate-300 bg-white text-sm">
      {LANGUAGES.map((l) => (
        <button
          key={l.code}
          type="button"
          onClick={() => onChange(l.code)}
          className={`px-4 py-2 ${value === l.code ? 'bg-slate-700 text-white' : 'hover:bg-slate-50'}`}
        >
          {l.label}
        </button>
      ))}
    </div>
  )
}

const dbHost = ((): string => {
  try {
    return new URL(import.meta.env.RENDERER_VITE_SUPABASE_URL as string).host
  } catch {
    return ''
  }
})()

export default function Settings(): React.JSX.Element {
  const { t, lang, setLang } = useI18n()
  const [exportLang, setExportLang] = useState<Lang>(() => loadExportLang(lang))
  const [company, setCompany] = useState<Company>(EMPTY_COMPANY)
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState<{ kind: 'ok' | 'error'; text: string } | null>(null)
  const [version, setVersion] = useState('')

  useEffect(() => {
    fetchCompany()
      .then(setCompany)
      .catch((e: unknown) =>
        setMessage({
          kind: 'error',
          text: `${t('loadError')}: ${e instanceof Error ? e.message : String(e)}`
        })
      )
      .finally(() => setLoading(false))
    window.api.getAppVersion().then(setVersion)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  function changeExportLang(code: Lang): void {
    setExportLang(code)
    saveExportLang(code)
  }

  function update(field: keyof Company, value: string): void {
    setCompany((c) => ({ ...c, [field]: value }))
  }

  async function onSave(e: FormEvent): Promise<void> {
    e.preventDefault()
    setBusy(true)
    setMessage(null)
    try {
      await saveCompany(company)
      setMessage({ kind: 'ok', text: t('settingsSaved') })
    } catch (err) {
      setMessage({ kind: 'error', text: err instanceof Error ? err.message : String(err) })
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="mx-auto max-w-3xl space-y-6 p-6">
      <h2 className="text-2xl font-bold text-slate-800">{t('settings')}</h2>

      <div className="space-y-5 rounded-xl bg-white p-5 shadow">
        <div>
          <span className="mb-1 block text-sm font-medium text-slate-700">{t('interfaceLanguage')}</span>
          <LangButtons value={lang} onChange={setLang} />
        </div>
        <div>
          <span className="mb-1 block text-sm font-medium text-slate-700">
            {t('defaultExportLanguage')}
          </span>
          <LangButtons value={exportLang} onChange={changeExportLang} />
          <p className="mt-1 text-xs text-slate-500">{t('exportLanguageHint')}</p>
        </div>
      </div>

      <form onSubmit={onSave} className="space-y-4 rounded-xl bg-white p-5 shadow">
        <div>
          <h3 className="text-lg font-bold text-slate-800">{t('companyDetails')}</h3>
          <p className="text-sm text-slate-500">{t('companyDetailsHint')}</p>
        </div>

        <Field label={t('companyLegalName')}>
          <input
            value={company.name}
            onChange={(e) => update('name', e.target.value)}
            disabled={loading}
            className={inputCls}
          />
        </Field>
        <Field label={t('address')}>
          <textarea
            rows={2}
            value={company.address}
            onChange={(e) => update('address', e.target.value)}
            disabled={loading}
            className={inputCls}
          />
        </Field>
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          <Field label={t('phone')}>
            <input
              value={company.phone}
              onChange={(e) => update('phone', e.target.value)}
              disabled={loading}
              className={inputCls}
            />
          </Field>
          <Field label={t('email')}>
            <input
              type="email"
              value={company.email}
              onChange={(e) => update('email', e.target.value)}
              disabled={loading}
              className={inputCls}
            />
          </Field>
        </div>
        <Field label={t('taxId')}>
          <input
            value={company.taxId}
            onChange={(e) => update('taxId', e.target.value)}
            disabled={loading}
            className={inputCls}
          />
        </Field>

        {message && (
          <p
            className={`rounded p-2 text-sm ${
              message.kind === 'ok' ? 'bg-green-50 text-green-800' : 'bg-red-50 text-red-700'
            }`}
          >
            {message.text}
          </p>
        )}

        <button
          type="submit"
          disabled={busy || loading}
          className="rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-60"
        >
          {busy ? t('saving') : t('save')}
        </button>
      </form>

      <div className="rounded-xl bg-white p-5 shadow">
        <div className="mb-3 flex items-center gap-3">
          <img src={LOGO} alt="" className="h-12 w-12" />
          <h3 className="text-lg font-bold text-slate-800">{t('about')}</h3>
        </div>
        <dl className="space-y-1 text-sm">
          <div className="flex gap-3">
            <dt className="w-32 text-slate-500">{t('appTitle')}</dt>
            <dd>
              {t('appVersion')} {version}
            </dd>
          </div>
          <div className="flex gap-3">
            <dt className="w-32 text-slate-500">{t('database')}</dt>
            <dd className="font-mono text-xs">{dbHost}</dd>
          </div>
        </dl>
      </div>
    </div>
  )
}