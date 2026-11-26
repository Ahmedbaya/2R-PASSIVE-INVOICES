import { useState } from 'react'
import { todayISO } from '../lib/format'
import { fetchJournal, fetchLedger, fetchPayments } from '../lib/reportData'
import { buildLegacyWorkbook } from '../lib/excelExport'
import { agingReportHtml, journalHtml } from '../lib/pdfReports'
import { backupToJson, backupToXlsx, fetchBackup } from '../lib/backup'
import { useI18n } from '../i18n/I18nProvider'
import { LANGUAGES, translations, type Dictionary, type Lang } from '../i18n/translations'

type Busy = 'excel' | 'aging' | 'journal' | 'backupXlsx' | 'backupJson' | null
type Msg = { kind: 'ok' | 'error' | 'info'; text: string }
type PresetKey = 'thisMonth' | 'lastMonth' | 'thisQuarter' | 'thisYear' | 'all'

const PRESETS: { key: PresetKey; label: keyof Dictionary }[] = [
  { key: 'thisMonth', label: 'presetThisMonth' },
  { key: 'lastMonth', label: 'presetLastMonth' },
  { key: 'thisQuarter', label: 'presetThisQuarter' },
  { key: 'thisYear', label: 'presetThisYear' },
  { key: 'all', label: 'presetAll' }
]

const COMPANY_KEY = 'app.companyName'
const EXPORT_LANG_KEY = 'app.exportLang'

const pad = (n: number): string => String(n).padStart(2, '0')
const iso = (y: number, m: number, d: number): string => `${y}-${pad(m)}-${pad(d)}`
const lastDay = (y: number, m: number): number => new Date(y, m, 0).getDate()

function presetRange(key: PresetKey): [string, string] {
  const now = new Date()
  const y = now.getFullYear()
  const m = now.getMonth() + 1
  switch (key) {
    case 'thisMonth':
      return [iso(y, m, 1), iso(y, m, lastDay(y, m))]
    case 'lastMonth': {
      const py = m === 1 ? y - 1 : y
      const pm = m === 1 ? 12 : m - 1
      return [iso(py, pm, 1), iso(py, pm, lastDay(py, pm))]
    }
    case 'thisQuarter': {
      const qs = Math.floor((m - 1) / 3) * 3 + 1
      return [iso(y, qs, 1), iso(y, qs + 2, lastDay(y, qs + 2))]
    }
    case 'thisYear':
      return [iso(y, 1, 1), iso(y, 12, 31)]
    default:
      return ['', '']
  }
}

function loadCompany(): string {
  try {
    return localStorage.getItem(COMPANY_KEY) ?? ''
  } catch {
    return ''
  }
}

function loadExportLang(fallback: Lang): Lang {
  try {
    const saved = localStorage.getItem(EXPORT_LANG_KEY)
    if (saved === 'en' || saved === 'fr' || saved === 'it') return saved
  } catch {
    /* ignore */
  }
  return fallback
}

const inputCls =
  'rounded-md border border-slate-300 bg-white px-3 py-2 text-sm outline-none focus:border-blue-500'

export default function Reports(): React.JSX.Element {
  const { t, lang } = useI18n()
  const [from, setFrom] = useState(() => presetRange('thisYear')[0])
  const [to, setTo] = useState(() => presetRange('thisYear')[1])
  const [company, setCompany] = useState(loadCompany)
  const [exportLang, setExportLang] = useState<Lang>(() => loadExportLang(lang))
  const [busy, setBusy] = useState<Busy>(null)
  const [message, setMessage] = useState<Msg | null>(null)

  // The exported files use the EXPORT language, not the language of the screen
  const exportT = (key: keyof Dictionary): string => translations[exportLang][key]
  const exportLocale = LANGUAGES.find((l) => l.code === exportLang)!.locale

  function changeExportLang(code: Lang): void {
    setExportLang(code)
    try {
      localStorage.setItem(EXPORT_LANG_KEY, code)
    } catch {
      /* ignore */
    }
  }

  function applyPreset(key: PresetKey): void {
    const [f, tt] = presetRange(key)
    setFrom(f)
    setTo(tt)
  }

  function onCompanyChange(value: string): void {
    setCompany(value)
    try {
      localStorage.setItem(COMPANY_KEY, value)
    } catch {
      /* ignore */
    }
  }

  function showResult(res: Awaited<ReturnType<typeof window.api.exportExcel>>): void {
    if (res.status === 'saved') setMessage({ kind: 'ok', text: `${t('savedTo')}: ${res.path}` })
    else if (res.status === 'error') {
      const blocked = /EPERM|EBUSY|EACCES/.test(res.message)
      setMessage({
        kind: 'error',
        text: blocked ? t('errFileLocked') : `${t('exportFailed')}: ${res.message}`
      })
    }
  }

  async function run(
    kind: Exclude<Busy, null>,
    job: () => Promise<void>,
    checkRange = true
  ): Promise<void> {
    setMessage(null)
    if (checkRange && from && to && from > to) {
      setMessage({ kind: 'error', text: t('errDateRange') })
      return
    }
    setBusy(kind)
    try {
      await job()
    } catch (e) {
      setMessage({
        kind: 'error',
        text: `${t('exportFailed')}: ${e instanceof Error ? e.message : String(e)}`
      })
    } finally {
      setBusy(null)
    }
  }

  const exportExcel = (): Promise<void> =>
    run('excel', async () => {
      const rows = await fetchLedger({ from, to })
      if (rows.length === 0) return setMessage({ kind: 'info', text: t('nothingToExport') })
      const payments = await fetchPayments(new Set(rows.map((r) => r.id)))
      const data = await buildLegacyWorkbook(rows, payments, { from, to }, exportLang)
      showResult(await window.api.exportExcel(`PASSIVE ANGLAIS ${todayISO()}.xlsx`, data))
    })

  const exportAging = (): Promise<void> =>
    run(
      'aging',
      async () => {
        const rows = await fetchLedger({ onlyOpen: true })
        if (rows.length === 0) return setMessage({ kind: 'info', text: t('noOpenDocs') })
        const html = agingReportHtml({
          rows,
          company: company.trim(),
          t: exportT,
          locale: exportLocale,
          lang: exportLang
        })
        showResult(await window.api.savePdf(`Aging report ${todayISO()}.pdf`, html, true))
      },
      false
    )

  const exportJournal = (): Promise<void> =>
    run('journal', async () => {
      const payments = await fetchJournal(from, to)
      if (payments.length === 0) return setMessage({ kind: 'info', text: t('nothingToExport') })
      const html = journalHtml({
        payments,
        from,
        to,
        company: company.trim(),
        t: exportT,
        locale: exportLocale,
        lang: exportLang
      })
      showResult(await window.api.savePdf(`Payment journal ${todayISO()}.pdf`, html, true))
    })

  const exportBackup = (kind: 'xlsx' | 'json'): Promise<void> =>
    run(
      kind === 'xlsx' ? 'backupXlsx' : 'backupJson',
      async () => {
        const backup = await fetchBackup()
        const name = `Backup ${todayISO()}.${kind}`
        if (kind === 'xlsx') showResult(await window.api.exportExcel(name, await backupToXlsx(backup)))
        else showResult(await window.api.exportJson(name, backupToJson(backup)))
      },
      false
    )

  const card = (
    title: string,
    description: string,
    button: string,
    kind: Exclude<Busy, null>,
    onClick: () => Promise<void>,
    color: string
  ): React.JSX.Element => (
    <div className="flex flex-col rounded-xl bg-white p-5 shadow">
      <h3 className="mb-2 text-lg font-bold text-slate-800">{title}</h3>
      <p className="mb-4 flex-1 text-sm text-slate-600">{description}</p>
      <button
        onClick={onClick}
        disabled={busy !== null}
        className={`rounded-md px-4 py-2 text-sm font-medium text-white disabled:opacity-60 ${color}`}
      >
        {busy === kind ? t('generating') : button}
      </button>
    </div>
  )

  const msgStyle: Record<Msg['kind'], string> = {
    ok: 'bg-green-50 text-green-800',
    error: 'bg-red-50 text-red-700',
    info: 'bg-amber-50 text-amber-800'
  }

  return (
    <div className="mx-auto max-w-6xl p-6">
      <h2 className="mb-4 text-2xl font-bold text-slate-800">{t('reportsTitle')}</h2>

      <div className="mb-6 space-y-4 rounded-xl bg-white p-5 shadow">
        <label className="block">
          <span className="mb-1 block text-sm font-medium text-slate-700">{t('companyName')}</span>
          <input
            value={company}
            onChange={(e) => onCompanyChange(e.target.value)}
            className={`${inputCls} w-full max-w-xl`}
          />
        </label>

        <div>
          <span className="mb-1 block text-sm font-medium text-slate-700">{t('exportLanguage')}</span>
          <div className="inline-flex overflow-hidden rounded-md border border-slate-300 bg-white text-sm">
            {LANGUAGES.map((l) => (
              <button
                key={l.code}
                onClick={() => changeExportLang(l.code)}
                className={`px-4 py-2 ${
                  exportLang === l.code ? 'bg-slate-700 text-white' : 'hover:bg-slate-50'
                }`}
              >
                {l.label}
              </button>
            ))}
          </div>
          <p className="mt-1 text-xs text-slate-500">{t('exportLanguageHint')}</p>
        </div>

        <div>
          <span className="mb-1 block text-sm font-medium text-slate-700">{t('period')}</span>
          <div className="flex flex-wrap items-center gap-3">
            <label className="flex items-center gap-2 text-sm text-slate-600">
              {t('dateFrom')}
              <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} className={inputCls} />
            </label>
            <label className="flex items-center gap-2 text-sm text-slate-600">
              {t('dateTo')}
              <input type="date" value={to} onChange={(e) => setTo(e.target.value)} className={inputCls} />
            </label>
            <div className="flex flex-wrap gap-2">
              {PRESETS.map((p) => (
                <button
                  key={p.key}
                  onClick={() => applyPreset(p.key)}
                  className="rounded-md border border-slate-300 bg-white px-3 py-1.5 text-sm hover:bg-slate-50"
                >
                  {t(p.label)}
                </button>
              ))}
            </div>
          </div>
        </div>
      </div>

      {message && (
        <p className={`mb-4 break-all rounded p-3 text-sm ${msgStyle[message.kind]}`}>{message.text}</p>
      )}

      <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
        {card(t('exportExcelTitle'), t('exportExcelDesc'), t('exportExcelBtn'), 'excel', exportExcel, 'bg-green-600 hover:bg-green-700')}
        {card(t('agingTitle'), t('agingDesc'), t('exportPdfBtn'), 'aging', exportAging, 'bg-blue-600 hover:bg-blue-700')}
        {card(t('journalTitle'), t('journalDesc'), t('exportPdfBtn'), 'journal', exportJournal, 'bg-blue-600 hover:bg-blue-700')}
      </div>

      <div className="mt-4 rounded-xl bg-white p-5 shadow">
        <h3 className="mb-2 text-lg font-bold text-slate-800">{t('backupTitle')}</h3>
        <p className="mb-4 text-sm text-slate-600">{t('backupDesc')}</p>
        <div className="flex flex-wrap gap-3">
          <button
            onClick={() => exportBackup('xlsx')}
            disabled={busy !== null}
            className="rounded-md bg-slate-700 px-4 py-2 text-sm font-medium text-white hover:bg-slate-800 disabled:opacity-60"
          >
            {busy === 'backupXlsx' ? t('generating') : t('backupXlsxBtn')}
          </button>
          <button
            onClick={() => exportBackup('json')}
            disabled={busy !== null}
            className="rounded-md bg-slate-700 px-4 py-2 text-sm font-medium text-white hover:bg-slate-800 disabled:opacity-60"
          >
            {busy === 'backupJson' ? t('generating') : t('backupJsonBtn')}
          </button>
        </div>
      </div>
    </div>
  )
}