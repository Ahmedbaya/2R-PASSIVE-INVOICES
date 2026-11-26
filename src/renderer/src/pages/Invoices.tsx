import { useCallback, useEffect, useRef, useState } from 'react'
import { supabase } from '../lib/supabase'
import { CURRENCIES, formatDate, formatMoney, type Currency } from '../lib/format'
import { DOC_TYPES, type DocType, type LedgerRow } from '../lib/types'
import { useI18n } from '../i18n/I18nProvider'
import type { Dictionary } from '../i18n/translations'
import StatusBadge from '../components/StatusBadge'
import InvoiceDrawer from '../components/InvoiceDrawer'
import InvoiceDetailDrawer from '../components/InvoiceDetailDrawer'
import PaymentModal from '../components/PaymentModal'

const PAGE_SIZE = 50

type StatusFilter = 'ALL' | 'UNPAID' | 'OVERDUE' | 'PARTIAL' | 'PAID' | 'VOID'
const STATUS_FILTERS: StatusFilter[] = ['ALL', 'UNPAID', 'OVERDUE', 'PARTIAL', 'PAID', 'VOID']

const selectCls =
  'rounded-md border border-slate-300 bg-white px-3 py-2 text-sm outline-none focus:border-blue-500'

export default function Invoices(): React.JSX.Element {
  const { t, locale } = useI18n()

  const [rows, setRows] = useState<LedgerRow[]>([])
  const [total, setTotal] = useState(0)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [page, setPage] = useState(0)

  const [searchInput, setSearchInput] = useState('')
  const [search, setSearch] = useState('')
  const [currency, setCurrency] = useState<Currency | 'ALL'>('ALL')
  const [status, setStatus] = useState<StatusFilter>('ALL')
  const [docType, setDocType] = useState<DocType | 'ALL'>('ALL')
  const [dateFrom, setDateFrom] = useState('')
  const [dateTo, setDateTo] = useState('')

  const [detailId, setDetailId] = useState<string | null>(null) // detail + payments drawer
  const [drawer, setDrawer] = useState<{ invoice: LedgerRow | null } | null>(null) // edit / create form
  const [quickPay, setQuickPay] = useState<LedgerRow | null>(null) // "Mark as paid" window

  // Wait 300 ms after typing before querying
  useEffect(() => {
    const id = setTimeout(() => {
      setSearch(searchInput)
      setPage(0)
    }, 300)
    return () => clearTimeout(id)
  }, [searchInput])

  const requestId = useRef(0)

  const load = useCallback(async () => {
    const myId = ++requestId.current

    let q = supabase.from('purchase_invoices_ledger').select('*', { count: 'exact' })

    if (currency !== 'ALL') q = q.eq('currency', currency)
    if (docType !== 'ALL') q = q.eq('doc_type', docType)
    if (status === 'ALL') q = q.neq('status', 'VOID')
    else if (status === 'PARTIAL') q = q.in('status', ['PARTIAL', 'PARTIAL_OVERDUE'])
    else q = q.eq('status', status)
    if (dateFrom) q = q.gte('invoice_date', dateFrom)
    if (dateTo) q = q.lte('invoice_date', dateTo)

    // Supplier name, supplier code, invoice number, cheque / transfer reference
    const term = search.replace(/[,()*%\\"]/g, ' ').trim()
    if (term) {
      q = q.or(
        `supplier_name.ilike."%${term}%",supplier_code.ilike."%${term}%",` +
          `invoice_number.ilike."%${term}%",payment_references.ilike."%${term}%"`
      )
    }

    const from = page * PAGE_SIZE
    const { data, error: err, count } = await q
      .order('invoice_date', { ascending: false })
      .order('created_at', { ascending: false })
      .range(from, from + PAGE_SIZE - 1)

    if (myId !== requestId.current) return // an older request finished late: ignore it
    if (err) {
      setError(err.message)
    } else {
      setError(null)
      setRows(data as LedgerRow[])
      setTotal(count ?? 0)
    }
    setLoading(false)
  }, [search, currency, status, docType, dateFrom, dateTo, page])

  useEffect(() => {
    load()
  }, [load])

  // Realtime: refresh when another PC changes invoices, payments or suppliers
  const loadRef = useRef(load)
  useEffect(() => {
    loadRef.current = load
  }, [load])

  useEffect(() => {
    const channel = supabase.channel(`invoices-page-${crypto.randomUUID()}`)
    for (const table of ['purchase_invoices', 'invoice_payments', 'suppliers']) {
      channel.on('postgres_changes', { event: '*', schema: 'public', table }, () => {
        loadRef.current()
      })
    }
    channel.subscribe()
    return () => {
      supabase.removeChannel(channel)
    }
  }, [])

  const filtersActive =
    searchInput !== '' ||
    currency !== 'ALL' ||
    status !== 'ALL' ||
    docType !== 'ALL' ||
    dateFrom !== '' ||
    dateTo !== ''

  function clearFilters(): void {
    setSearchInput('')
    setSearch('')
    setCurrency('ALL')
    setStatus('ALL')
    setDocType('ALL')
    setDateFrom('')
    setDateTo('')
    setPage(0)
  }

  const firstShown = total === 0 ? 0 : page * PAGE_SIZE + 1
  const lastShown = Math.min((page + 1) * PAGE_SIZE, total)

  return (
    <div className="mx-auto max-w-7xl p-6">
      <div className="mb-4 flex items-center justify-between">
        <h2 className="text-2xl font-bold text-slate-800">{t('invoices')}</h2>
        <button
          onClick={() => setDrawer({ invoice: null })}
          className="rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700"
        >
          + {t('newInvoice')}
        </button>
      </div>

      <div className="mb-4 flex flex-wrap items-center gap-3">
        <input
          value={searchInput}
          onChange={(e) => setSearchInput(e.target.value)}
          placeholder={t('searchInvoices')}
          className="w-96 max-w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm outline-none focus:border-blue-500"
        />
        <select
          value={currency}
          onChange={(e) => {
            setCurrency(e.target.value as Currency | 'ALL')
            setPage(0)
          }}
          className={selectCls}
        >
          <option value="ALL">{t('allCurrencies')}</option>
          {CURRENCIES.map((c) => (
            <option key={c} value={c}>
              {c}
            </option>
          ))}
        </select>
        <select
          value={status}
          onChange={(e) => {
            setStatus(e.target.value as StatusFilter)
            setPage(0)
          }}
          className={selectCls}
        >
          {STATUS_FILTERS.map((s) => (
            <option key={s} value={s}>
              {s === 'ALL' ? t('allStatuses') : t(`status_${s}` as keyof Dictionary)}
            </option>
          ))}
        </select>
        <select
          value={docType}
          onChange={(e) => {
            setDocType(e.target.value as DocType | 'ALL')
            setPage(0)
          }}
          className={selectCls}
        >
          <option value="ALL">{t('allTypes')}</option>
          {DOC_TYPES.map((d) => (
            <option key={d} value={d}>
              {t(`type_${d}` as keyof Dictionary)}
            </option>
          ))}
        </select>
        <label className="flex items-center gap-2 text-sm text-slate-600">
          {t('dateFrom')}
          <input
            type="date"
            value={dateFrom}
            onChange={(e) => {
              setDateFrom(e.target.value)
              setPage(0)
            }}
            className={selectCls}
          />
        </label>
        <label className="flex items-center gap-2 text-sm text-slate-600">
          {t('dateTo')}
          <input
            type="date"
            value={dateTo}
            onChange={(e) => {
              setDateTo(e.target.value)
              setPage(0)
            }}
            className={selectCls}
          />
        </label>
        {filtersActive && (
          <button onClick={clearFilters} className="text-sm text-blue-700 hover:underline">
            {t('clearFilters')}
          </button>
        )}
      </div>

      {error && (
        <p className="mb-4 rounded bg-red-50 p-3 text-sm text-red-700">
          {t('loadError')}: {error}
        </p>
      )}

      <div className="overflow-x-auto rounded-xl bg-white shadow">
        <table className="w-full text-left text-sm">
          <thead className="bg-slate-100 text-xs uppercase text-slate-600">
            <tr>
              <th className="whitespace-nowrap px-3 py-3">{t('colInvoiceDate')}</th>
              <th className="px-3 py-3">{t('colSupplier')}</th>
              <th className="px-3 py-3">{t('colNumber')}</th>
              <th className="px-3 py-3">{t('colType')}</th>
              <th className="whitespace-nowrap px-3 py-3">{t('colDueDate')}</th>
              <th className="px-3 py-3 text-right">{t('colAmount')}</th>
              <th className="px-3 py-3 text-right">{t('colPaid')}</th>
              <th className="px-3 py-3 text-right">{t('colRemaining')}</th>
              <th className="px-3 py-3">{t('colStatus')}</th>
              <th className="px-3 py-3" />
            </tr>
          </thead>
          <tbody>
            {loading && (
              <tr>
                <td colSpan={10} className="px-4 py-6 text-center text-slate-500">
                  {t('loading')}
                </td>
              </tr>
            )}
            {!loading && rows.length === 0 && (
              <tr>
                <td colSpan={10} className="px-4 py-6 text-center text-slate-500">
                  {filtersActive ? t('noResults') : t('noInvoices')}
                </td>
              </tr>
            )}
            {rows.map((r) => {
              const remaining = Number(r.remaining_amount)
              const late = r.status === 'OVERDUE' || r.status === 'PARTIAL_OVERDUE'
              return (
                <tr
                  key={r.id}
                  onClick={() => setDetailId(r.id)}
                  className={`cursor-pointer border-t hover:bg-blue-50 ${
                    r.is_void ? 'opacity-50' : late ? 'bg-red-50/60' : ''
                  }`}
                >
                  <td className="whitespace-nowrap px-3 py-3">{formatDate(r.invoice_date)}</td>
                  <td className="px-3 py-3">
                    <div className="font-medium">{r.supplier_name}</div>
                    <div className="font-mono text-xs text-slate-500">{r.supplier_code}</div>
                  </td>
                  <td className="px-3 py-3">
                    {r.invoice_number}
                    {r.attachment_path && (
                      <span title={t('attachment')} className="ml-1.5">
                        📎
                      </span>
                    )}
                  </td>
                  <td className="whitespace-nowrap px-3 py-3 text-xs">
                    {t(`type_${r.doc_type}` as keyof Dictionary)}
                  </td>
                  <td className="whitespace-nowrap px-3 py-3">{formatDate(r.due_date)}</td>
                  <td className="whitespace-nowrap px-3 py-3 text-right">
                    {formatMoney(r.invoice_amount, r.currency, locale)}
                  </td>
                  <td className="px-3 py-3 text-right">
                    <div className="whitespace-nowrap">
                      {formatMoney(r.total_paid, r.currency, locale)}
                    </div>
                    {r.payment_count > 0 && (
                      <div className="text-xs text-slate-500">
                        {formatDate(r.last_payment_date)} · {r.payment_summary}
                      </div>
                    )}
                  </td>
                  <td
                    className={`whitespace-nowrap px-3 py-3 text-right ${
                      remaining > 0 && !r.is_void ? 'font-bold text-red-600' : 'text-slate-400'
                    }`}
                  >
                    {formatMoney(remaining, r.currency, locale)}
                  </td>
                  <td className="px-3 py-3">
                    <StatusBadge status={r.status} />
                  </td>
                  <td className="px-3 py-3 text-right">
                    {remaining > 0 && !r.is_void && (
                      <button
                        onClick={(e) => {
                          e.stopPropagation()
                          setQuickPay(r)
                        }}
                        className="whitespace-nowrap rounded-md bg-green-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-green-700"
                      >
                        ✓ {t('markAsPaid')}
                      </button>
                    )}
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>

      <div className="mt-4 flex items-center justify-between text-sm text-slate-600">
        <span>
          {firstShown}–{lastShown} {t('pageOf')} {total}
        </span>
        <div className="flex gap-2">
          <button
            onClick={() => setPage((p) => Math.max(0, p - 1))}
            disabled={page === 0}
            className="rounded-md border border-slate-300 bg-white px-3 py-1.5 hover:bg-slate-50 disabled:opacity-40"
          >
            {t('previous')}
          </button>
          <button
            onClick={() => setPage((p) => p + 1)}
            disabled={lastShown >= total}
            className="rounded-md border border-slate-300 bg-white px-3 py-1.5 hover:bg-slate-50 disabled:opacity-40"
          >
            {t('next')}
          </button>
        </div>
      </div>

      {detailId && (
        <InvoiceDetailDrawer
          invoiceId={detailId}
          onClose={() => setDetailId(null)}
          onChanged={load}
          onEdit={(inv) => {
            setDetailId(null)
            setDrawer({ invoice: inv })
          }}
        />
      )}

      {drawer && (
        <InvoiceDrawer
          invoice={drawer.invoice}
          onClose={() => setDrawer(null)}
          onSaved={() => {
            const backTo = drawer.invoice?.id ?? null
            setDrawer(null)
            load()
            if (backTo) setDetailId(backTo) // after editing, return to the detail view
          }}
        />
      )}

      {quickPay && (
        <PaymentModal
          invoice={quickPay}
          payment={null}
          quick
          onClose={() => setQuickPay(null)}
          onSaved={() => {
            setQuickPay(null)
            load()
          }}
        />
      )}
    </div>
  )
}