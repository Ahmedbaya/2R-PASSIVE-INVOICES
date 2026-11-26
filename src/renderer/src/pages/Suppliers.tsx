import { useCallback, useEffect, useMemo, useState } from 'react'
import { supabase } from '../lib/supabase'
import { CURRENCIES, formatMoney, type Currency } from '../lib/format'
import type { SupplierRow } from '../lib/types'
import { useI18n } from '../i18n/I18nProvider'
import type { Dictionary } from '../i18n/translations'
import SupplierDrawer from '../components/SupplierDrawer'

type Filter = 'active' | 'archived' | 'all'

const FILTERS: { value: Filter; label: keyof Dictionary }[] = [
  { value: 'active', label: 'filterActive' },
  { value: 'archived', label: 'filterArchived' },
  { value: 'all', label: 'filterAll' }
]

function openBalance(s: SupplierRow, c: Currency): number {
  return Number(c === 'TND' ? s.open_tnd : c === 'EUR' ? s.open_eur : s.open_usd)
}

export default function Suppliers(): React.JSX.Element {
  const { t, locale } = useI18n()
  const [rows, setRows] = useState<SupplierRow[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [search, setSearch] = useState('')
  const [filter, setFilter] = useState<Filter>('active')
  const [drawer, setDrawer] = useState<{ supplier: SupplierRow | null } | null>(null)

  const load = useCallback(async () => {
    const { data, error: err } = await supabase
      .from('suppliers_overview')
      .select('*')
      .order('supplier_code')
    if (err) {
      setError(err.message)
    } else {
      setError(null)
      setRows(data as SupplierRow[])
    }
    setLoading(false)
  }, [])

  // Load, then refresh automatically when another PC changes suppliers, invoices or payments
  useEffect(() => {
    load()
    const channel = supabase.channel(`suppliers-page-${crypto.randomUUID()}`)
    for (const table of ['suppliers', 'purchase_invoices', 'invoice_payments']) {
      channel.on('postgres_changes', { event: '*', schema: 'public', table }, () => {
        load()
      })
    }
    channel.subscribe()
    return () => {
      supabase.removeChannel(channel)
    }
  }, [load])

  const visible = useMemo(() => {
    const q = search.trim().toLowerCase()
    return rows.filter((r) => {
      if (filter === 'active' && !r.is_active) return false
      if (filter === 'archived' && r.is_active) return false
      if (!q) return true
      return [r.supplier_code, r.name, r.contact_name, r.phone, r.email, r.tax_id].some((v) =>
        v?.toLowerCase().includes(q)
      )
    })
  }, [rows, search, filter])

  return (
    <div className="mx-auto max-w-6xl p-6">
      <div className="mb-4 flex items-center justify-between">
        <h2 className="text-2xl font-bold text-slate-800">{t('suppliers')}</h2>
        <button
          onClick={() => setDrawer({ supplier: null })}
          className="rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700"
        >
          + {t('newSupplier')}
        </button>
      </div>

      <div className="mb-4 flex flex-wrap items-center gap-3">
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder={t('searchSuppliers')}
          className="w-96 max-w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm outline-none focus:border-blue-500"
        />
        <div className="flex overflow-hidden rounded-md border border-slate-300 bg-white text-sm">
          {FILTERS.map((f) => (
            <button
              key={f.value}
              onClick={() => setFilter(f.value)}
              className={`px-3 py-2 ${
                filter === f.value ? 'bg-slate-700 text-white' : 'hover:bg-slate-50'
              }`}
            >
              {t(f.label)}
            </button>
          ))}
        </div>
      </div>

      {error && (
        <p className="mb-4 rounded bg-red-50 p-3 text-sm text-red-700">
          {t('loadError')}: {error}
        </p>
      )}

      <div className="overflow-hidden rounded-xl bg-white shadow">
        <table className="w-full text-left text-sm">
          <thead className="bg-slate-100 text-xs uppercase text-slate-600">
            <tr>
              <th className="px-4 py-3">{t('colCode')}</th>
              <th className="px-4 py-3">{t('colName')}</th>
              <th className="px-4 py-3">{t('colCurrency')}</th>
              <th className="px-4 py-3">{t('colContact')}</th>
              <th className="px-4 py-3 text-right">{t('colInvoices')}</th>
              <th className="px-4 py-3 text-right">{t('colOpenBalance')}</th>
            </tr>
          </thead>
          <tbody>
            {loading && (
              <tr>
                <td colSpan={6} className="px-4 py-6 text-center text-slate-500">
                  {t('loading')}
                </td>
              </tr>
            )}
            {!loading && visible.length === 0 && (
              <tr>
                <td colSpan={6} className="px-4 py-6 text-center text-slate-500">
                  {rows.length === 0 ? t('noSuppliers') : t('noResults')}
                </td>
              </tr>
            )}
            {visible.map((s) => {
              const open = CURRENCIES.map((c) => ({ c, v: openBalance(s, c) })).filter(
                (x) => x.v > 0
              )
              return (
                <tr
                  key={s.id}
                  onClick={() => setDrawer({ supplier: s })}
                  className={`cursor-pointer border-t hover:bg-blue-50 ${
                    s.is_active ? '' : 'opacity-60'
                  }`}
                >
                  <td className="px-4 py-3 font-mono">{s.supplier_code}</td>
                  <td className="px-4 py-3 font-medium">
                    {s.name}
                    {!s.is_active && (
                      <span className="ml-2 rounded bg-slate-200 px-2 py-0.5 text-xs text-slate-600">
                        {t('archivedBadge')}
                      </span>
                    )}
                  </td>
                  <td className="px-4 py-3">{s.default_currency}</td>
                  <td className="px-4 py-3">
                    <div>{s.contact_name}</div>
                    <div className="text-xs text-slate-500">{s.phone}</div>
                  </td>
                  <td className="px-4 py-3 text-right">{s.invoice_count}</td>
                  <td className="px-4 py-3 text-right">
                    {open.length === 0 ? (
                      <span className="text-slate-400">—</span>
                    ) : (
                      open.map(({ c, v }) => (
                        <div key={c} className="font-bold text-red-600">
                          {formatMoney(v, c, locale)}
                        </div>
                      ))
                    )}
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>

      {drawer && (
        <SupplierDrawer
          supplier={drawer.supplier}
          onClose={() => setDrawer(null)}
          onSaved={() => {
            setDrawer(null)
            load()
          }}
        />
      )}
    </div>
  )
}