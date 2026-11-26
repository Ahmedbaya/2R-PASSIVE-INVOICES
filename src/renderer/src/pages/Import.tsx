import { useMemo, useRef, useState, type DragEvent } from 'react'
import { supabase } from '../lib/supabase'
import { CURRENCIES, formatDate, formatMoney, type Currency } from '../lib/format'
import {
  analyze,
  buildPayload,
  normName,
  parseWorkbook,
  type DbInvoice,
  type DbSupplier,
  type Issue,
  type ParsedRow
} from '../lib/legacyImport'
import { useI18n } from '../i18n/I18nProvider'
import type { Dictionary } from '../i18n/translations'

type Stage = 'pick' | 'preview' | 'done'

interface ImportResult {
  suppliers: number
  invoices: number
  payments: number
}

const KIND_STYLE: Record<ParsedRow['kind'], string> = {
  ok: 'bg-green-100 text-green-800',
  warning: 'bg-amber-100 text-amber-800',
  error: 'bg-red-600 text-white',
  duplicate: 'bg-slate-200 text-slate-700'
}

const ISSUE_STYLE: Record<Issue['level'], string> = {
  error: 'text-red-700',
  warning: 'text-amber-700',
  info: 'text-slate-500'
}

const selectable = (r: ParsedRow): boolean => r.kind === 'ok' || r.kind === 'warning'

async function fetchSuppliers(): Promise<DbSupplier[]> {
  const { data, error } = await supabase.from('suppliers').select('id, supplier_code, name')
  if (error) throw new Error(error.message)
  return data as DbSupplier[]
}

async function fetchInvoices(): Promise<DbInvoice[]> {
  const out: DbInvoice[] = []
  for (let from = 0; ; from += 1000) {
    const { data, error } = await supabase
      .from('purchase_invoices')
      .select('supplier_id, invoice_number, invoice_date, currency, invoice_amount')
      .order('id')
      .range(from, from + 999)
    if (error) throw new Error(error.message)
    out.push(...((data ?? []) as DbInvoice[]))
    if (!data || data.length < 1000) break
  }
  return out
}

export default function ImportPage({
  onGoToInvoices
}: {
  onGoToInvoices: () => void
}): React.JSX.Element {
  const { t, locale } = useI18n()

  const [stage, setStage] = useState<Stage>('pick')
  const [fileName, setFileName] = useState('')
  const [sheetName, setSheetName] = useState('')
  const [skipped, setSkipped] = useState(0)
  const [rows, setRows] = useState<ParsedRow[]>([])
  const [selected, setSelected] = useState<Set<number>>(new Set())
  const [onlyAttention, setOnlyAttention] = useState(false)
  const [busy, setBusy] = useState(false)
  const [dragging, setDragging] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [result, setResult] = useState<ImportResult | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  const issueText = (i: Issue): string => t(i.key as keyof Dictionary).replace('{0}', i.arg ?? '')

  function reset(): void {
    setStage('pick')
    setRows([])
    setSelected(new Set())
    setResult(null)
    setError(null)
    setOnlyAttention(false)
  }

  async function handleFile(file: File | undefined): Promise<void> {
    if (!file) return
    setError(null)
    if (!/\.xlsx$/i.test(file.name)) return setError(t('errXlsxOnly'))

    setBusy(true)
    try {
      const parsed = await parseWorkbook(file)
      const [suppliers, invoices] = await Promise.all([fetchSuppliers(), fetchInvoices()])
      const analysed = analyze(parsed.rows, suppliers, invoices)
      setFileName(file.name)
      setSheetName(parsed.sheetName)
      setSkipped(parsed.skipped)
      setRows(analysed)
      setSelected(new Set(analysed.filter(selectable).map((r) => r.sheetRow)))
      setStage('preview')
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      setError(msg === 'NO_SHEET' ? t('errNoSheet') : `${t('errReadFile')}: ${msg}`)
    } finally {
      setBusy(false)
    }
  }

  function onDrop(e: DragEvent): void {
    e.preventDefault()
    setDragging(false)
    handleFile(e.dataTransfer.files?.[0])
  }

  function toggle(sheetRow: number): void {
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(sheetRow)) next.delete(sheetRow)
      else next.add(sheetRow)
      return next
    })
  }

  const importable = useMemo(() => rows.filter(selectable), [rows])
  const allSelected = importable.length > 0 && importable.every((r) => selected.has(r.sheetRow))

  function toggleAll(): void {
    setSelected(allSelected ? new Set() : new Set(importable.map((r) => r.sheetRow)))
  }

  const counts = useMemo(() => {
    const c = { ok: 0, warning: 0, error: 0, duplicate: 0 }
    for (const r of rows) c[r.kind]++
    const newSuppliers = new Set<string>()
    for (const r of rows) {
      if (selected.has(r.sheetRow) && r.isNewSupplier) newSuppliers.add(normName(r.supplierName))
    }
    return { ...c, newSuppliers: newSuppliers.size }
  }, [rows, selected])

  const totals = useMemo(() => {
    const acc: Record<Currency, { invoiced: number; paid: number }> = {
      TND: { invoiced: 0, paid: 0 },
      EUR: { invoiced: 0, paid: 0 },
      USD: { invoiced: 0, paid: 0 }
    }
    for (const r of rows) {
      if (!selected.has(r.sheetRow) || !r.currency || r.amount === null) continue
      acc[r.currency].invoiced += r.amount
      acc[r.currency].paid += r.payments.reduce((s, p) => s + p.amount, 0)
    }
    return acc
  }, [rows, selected])

  async function doImport(): Promise<void> {
    const chosen = rows.filter((r) => selected.has(r.sheetRow) && selectable(r))
    if (chosen.length === 0) return
    setBusy(true)
    setError(null)
    try {
      const suppliers = await fetchSuppliers() // fresh list, so new codes never collide
      const payload = buildPayload(chosen, suppliers)
      const { data, error: err } = await supabase.rpc('import_legacy_ledger', { p_data: payload })
      if (err) throw new Error(err.message)
      setResult(data as ImportResult)
      setStage('done')
    } catch (e) {
      setError(`${t('errImportFailed')}: ${e instanceof Error ? e.message : String(e)}`)
    } finally {
      setBusy(false)
    }
  }

  const shown = onlyAttention ? rows.filter((r) => r.kind !== 'ok') : rows

  // ---------- Stage 1: choose the file ----------
  if (stage === 'pick') {
    return (
      <div className="mx-auto max-w-3xl p-6">
        <h2 className="mb-2 text-2xl font-bold text-slate-800">{t('importTitle')}</h2>
        <p className="mb-6 text-sm text-slate-600">{t('importIntro')}</p>

        <input
          ref={inputRef}
          type="file"
          hidden
          accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
          onChange={(e) => {
            handleFile(e.target.files?.[0])
            e.target.value = ''
          }}
        />
        <div
          onDragOver={(e) => {
            e.preventDefault()
            setDragging(true)
          }}
          onDragLeave={() => setDragging(false)}
          onDrop={onDrop}
          className={`rounded-xl border-2 border-dashed p-10 text-center ${
            dragging ? 'border-blue-500 bg-blue-50' : 'border-slate-300 bg-white'
          }`}
        >
          <button
            type="button"
            disabled={busy}
            onClick={() => inputRef.current?.click()}
            className="text-slate-500 hover:text-blue-700 disabled:opacity-60"
          >
            {busy ? t('reading') : `📊 ${t('dropExcel')}`}
          </button>
        </div>

        {error && <p className="mt-4 rounded bg-red-50 p-3 text-sm text-red-700">{error}</p>}
      </div>
    )
  }

  // ---------- Stage 3: done ----------
  if (stage === 'done' && result) {
    return (
      <div className="mx-auto max-w-3xl p-6">
        <div className="rounded-xl bg-white p-8 text-center shadow">
          <div className="mb-2 text-4xl">✅</div>
          <h2 className="mb-6 text-2xl font-bold text-slate-800">{t('importDone')}</h2>
          <dl className="mx-auto mb-8 grid max-w-md grid-cols-3 gap-4">
            <div>
              <dd className="text-2xl font-bold">{result.suppliers}</dd>
              <dt className="text-xs uppercase text-slate-500">{t('importedSuppliers')}</dt>
            </div>
            <div>
              <dd className="text-2xl font-bold">{result.invoices}</dd>
              <dt className="text-xs uppercase text-slate-500">{t('importedInvoices')}</dt>
            </div>
            <div>
              <dd className="text-2xl font-bold">{result.payments}</dd>
              <dt className="text-xs uppercase text-slate-500">{t('importedPayments')}</dt>
            </div>
          </dl>
          <div className="flex justify-center gap-3">
            <button
              onClick={onGoToInvoices}
              className="rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700"
            >
              {t('goToInvoices')}
            </button>
            <button
              onClick={reset}
              className="rounded-md border border-slate-300 px-4 py-2 text-sm hover:bg-slate-50"
            >
              {t('importAnother')}
            </button>
          </div>
        </div>
      </div>
    )
  }

  // ---------- Stage 2: preview ----------
  const card = (label: string, value: number, cls = ''): React.JSX.Element => (
    <div className="rounded-lg bg-white p-3 text-center shadow">
      <div className={`text-2xl font-bold ${cls}`}>{value}</div>
      <div className="text-xs uppercase text-slate-500">{label}</div>
    </div>
  )

  return (
    <div className="mx-auto max-w-7xl p-6">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-2xl font-bold text-slate-800">{t('importTitle')}</h2>
          <p className="text-sm text-slate-500">
            {fileName} · {t('sheetLabel')}: {sheetName}
            {skipped > 0 && ` · ${skipped} ${t('skippedRows').toLowerCase()}`}
          </p>
        </div>
        <div className="flex gap-3">
          <button
            onClick={reset}
            className="rounded-md border border-slate-300 bg-white px-4 py-2 text-sm hover:bg-slate-50"
          >
            {t('chooseAnother')}
          </button>
          <button
            onClick={doImport}
            disabled={busy || selected.size === 0}
            className="rounded-md bg-green-600 px-4 py-2 text-sm font-medium text-white hover:bg-green-700 disabled:opacity-50"
          >
            {busy ? t('importing') : t('importButton').replace('{0}', String(selected.size))}
          </button>
        </div>
      </div>

      {error && <p className="mb-4 rounded bg-red-50 p-3 text-sm text-red-700">{error}</p>}

      <div className="mb-4 grid grid-cols-2 gap-3 md:grid-cols-6">
        {card(t('sumRows'), rows.length)}
        {card(t('sumReady'), counts.ok, 'text-green-700')}
        {card(t('sumWarnings'), counts.warning, 'text-amber-700')}
        {card(t('sumErrors'), counts.error, 'text-red-700')}
        {card(t('sumDuplicates'), counts.duplicate, 'text-slate-600')}
        {card(t('sumNewSuppliers'), counts.newSuppliers)}
      </div>

      <div className="mb-4 rounded-lg bg-white p-4 shadow">
        <h3 className="mb-2 text-xs font-bold uppercase text-slate-500">{t('totalsSelected')}</h3>
        <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
          {CURRENCIES.map((c) => (
            <div key={c} className="text-sm">
              <span className="mr-2 font-bold">{c}</span>
              {t('totalInvoiced')}: {formatMoney(totals[c].invoiced, c, locale)} · {t('totalPaid')}:{' '}
              {formatMoney(totals[c].paid, c, locale)}
            </div>
          ))}
        </div>
      </div>

      <label className="mb-3 flex items-center gap-2 text-sm text-slate-600">
        <input
          type="checkbox"
          checked={onlyAttention}
          onChange={(e) => setOnlyAttention(e.target.checked)}
        />
        {t('onlyAttention')}
      </label>

      <div className="overflow-x-auto rounded-xl bg-white shadow">
        <table className="w-full text-left text-sm">
          <thead className="bg-slate-100 text-xs uppercase text-slate-600">
            <tr>
              <th className="px-3 py-3">
                <input
                  type="checkbox"
                  checked={allSelected}
                  onChange={toggleAll}
                  title={t('selectAll')}
                  aria-label={t('selectAll')}
                />
              </th>
              <th className="px-3 py-3">{t('colRow')}</th>
              <th className="px-3 py-3">{t('colSupplier')}</th>
              <th className="px-3 py-3">{t('colNumber')}</th>
              <th className="whitespace-nowrap px-3 py-3">{t('colInvoiceDate')}</th>
              <th className="whitespace-nowrap px-3 py-3">{t('colDueDate')}</th>
              <th className="px-3 py-3 text-right">{t('colAmount')}</th>
              <th className="px-3 py-3 text-right">{t('colPaid')}</th>
              <th className="px-3 py-3">{t('colMethod')}</th>
              <th className="px-3 py-3" />
              <th className="px-3 py-3">{t('colRemarks')}</th>
            </tr>
          </thead>
          <tbody>
            {shown.map((r) => {
              const paid = r.payments.reduce((s, p) => s + p.amount, 0)
              const can = selectable(r)
              return (
                <tr key={r.sheetRow} className={`border-t align-top ${can ? '' : 'bg-slate-50'}`}>
                  <td className="px-3 py-3">
                    <input
                      type="checkbox"
                      disabled={!can}
                      checked={selected.has(r.sheetRow)}
                      onChange={() => toggle(r.sheetRow)}
                    />
                  </td>
                  <td className="px-3 py-3 font-mono text-xs text-slate-500">{r.sheetRow}</td>
                  <td className="px-3 py-3 font-medium">
                    {r.supplierName}
                    {r.isNewSupplier && can && (
                      <span className="ml-2 rounded bg-blue-100 px-1.5 py-0.5 text-xs font-normal text-blue-700">
                        {t('newBadge')}
                      </span>
                    )}
                  </td>
                  <td className="px-3 py-3">{r.invoiceNumber}</td>
                  <td className="whitespace-nowrap px-3 py-3">{formatDate(r.invoiceDate)}</td>
                  <td className="whitespace-nowrap px-3 py-3">{formatDate(r.dueDate)}</td>
                  <td className="whitespace-nowrap px-3 py-3 text-right">
                    {r.currency && r.amount !== null ? formatMoney(r.amount, r.currency, locale) : '—'}
                  </td>
                  <td className="whitespace-nowrap px-3 py-3 text-right">
                    {r.currency && paid > 0 ? formatMoney(paid, r.currency, locale) : '—'}
                  </td>
                  <td className="px-3 py-3 text-xs">
                    {r.payments.map((p, i) => (
                      <div key={i}>
                        {t(`method_${p.method}` as keyof Dictionary)}
                        {p.reference && <span className="font-mono"> N°{p.reference}</span>}
                      </div>
                    ))}
                  </td>
                  <td className="px-3 py-3">
                    <span
                      className={`inline-block whitespace-nowrap rounded-full px-2.5 py-0.5 text-xs font-semibold ${KIND_STYLE[r.kind]}`}
                    >
                      {t(`kind_${r.kind}` as keyof Dictionary)}
                    </span>
                  </td>
                  <td className="px-3 py-3 text-xs">
                    {r.issues.map((i, idx) => (
                      <div key={idx} className={ISSUE_STYLE[i.level]}>
                        {issueText(i)}
                      </div>
                    ))}
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </div>
  )
}