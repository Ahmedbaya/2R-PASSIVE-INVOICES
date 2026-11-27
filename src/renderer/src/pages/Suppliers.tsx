import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { supabase } from '../lib/supabase'
import { CURRENCIES, formatMoney, type Currency } from '../lib/format'
import type { LedgerRow, SupplierRow } from '../lib/types'
import { useI18n } from '../i18n/I18nProvider'
import type { Dictionary } from '../i18n/translations'
import SupplierDrawer from '../components/SupplierDrawer'
import SupplierProfileDrawer from '../components/SupplierProfileDrawer'
import InvoiceDetailDrawer from '../components/InvoiceDetailDrawer'
import InvoiceDrawer from '../components/InvoiceDrawer'

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
  const [itemMatches, setItemMatches] = useState<Set<string>>(new Set())

  const [profileId, setProfileId] = useState<string | null>(null) // supplier profile
  const [drawer, setDrawer] = useState<{ supplier: SupplierRow | null } | null>(null) // edit / create form
  const [detailId, setDetailId] = useState<string | null>(null) // invoice details
  const [editInvoice, setEditInvoice] = useState<LedgerRow | null>(null) // invoice edit form

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

  const loadRef = useRef(load)
  useEffect(() => {
    loadRef.current = load
  }, [load])

  // Load, then refresh automatically when another PC changes suppliers, items, invoices or payments
  useEffect(() => {
    void load()
    const channel = supabase.channel(`suppliers-page-${crypto.randomUUID()}`)
    for (const table of ['suppliers', 'supplier_items', 'purchase_invoices', 'invoice_payments']) {
      channel.on('postgres_changes', { event: '*', schema: 'public', table }, () => {
        void loadRef.current()
      })
    }
    channel.subscribe()
    return () => {
      void supabase.removeChannel(channel)
    }
  }, [load])

  // Search by item: which suppliers sell something that matches the typed text?
  useEffect(() => {
    const term = search.replace(/[%_,()*\\"]/g, ' ').trim()
    if (term.length < 2) {
      setItemMatches(new Set())
      return
    }
    let cancelled = false
    const id = setTimeout(() => {
      supabase
        .from('supplier_items')
        .select('supplier_id')
        .or(`name.ilike."%${term}%",reference.ilike."%${term}%"`)
        .limit(1000)
        .then(({ data }) => {
          if (cancelled) return
          setItemMatches(new Set((data ?? []).map((r) => (r as { supplier_id: string }).supplier_id)))
        })
    }, 300)
    return () => {
      cancelled = true
      clearTimeout(id)
    }
  }, [search])

  const visible = useMemo(() => {
    const q = search.trim().toLowerCase()
    return rows.filter((r) => {
      if (filter === 'active' && !r.is_active) return false
      if (filter === 'archived' && r.is_active) return false
      if (!q) return true
      return (
        itemMatches.has(r.id) ||
        [r.supplier_code, r.name, r.activity, r.contact_name, r.phone, r.email, r.tax_id].some((v) =>
          v?.toLowerCase().includes(q)
        )
      )
    })
  }, [rows, search, filter, itemMatches])

  const profile = profileId ? (rows.find((r) => r.id === profileId) ?? null) : null

  return (
    <div className="mx-auto max-w-7xl p-6">
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
          placeholder={t('searchSuppliersAndItems')}
          className="w-[28rem] max-w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm outline-none focus:border-blue-500"
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

      <div className="overflow-x-auto rounded-xl bg-white shadow">
        <table className="w-full text-left text-sm">
          <thead className="bg-slate-100 text-xs uppercase text-slate-600">
            <tr>
              <th className="px-4 py-3">{t('colCode')}</th>
              <th className="px-4 py-3">{t('colName')}</th>
              <th className="px-4 py-3">{t('colCurrency')}</th>
              <th className="px-4 py-3">{t('colContact')}</th>
              <th className="px-4 py-3 text-right">{t('colItems')}</th>
              <th className="px-4 py-3 text-right">{t('colInvoices')}</th>
              <th className="px-4 py-3 text-right">{t('colOpenBalance')}</th>
            </tr>
          </thead>
          <tbody>
            {loading && (
              <tr>
                <td colSpan={7} className="px-4 py-6 text-center text-slate-500">
                  {t('loading')}
                </td>
              </tr>
            )}
            {!loading && visible.length === 0 && (
              <tr>
                <td colSpan={7} className="px-4 py-6 text-center text-slate-500">
                  {rows.length === 0 ? t('noSuppliers') : t('noResults')}
                </td>
              </tr>
            )}
            {visible.map((s) => {
              const open = CURRENCIES.map((c) => ({ c, v: openBalance(s, c) })).filter((x) => x.v > 0)
              return (
                <tr
                  key={s.id}
                  onClick={() => setProfileId(s.id)}
                  className={`cursor-pointer border-t hover:bg-blue-50 ${
                    s.is_active ? '' : 'opacity-60'
                  }`}
                >
                  <td className="px-4 py-3 font-mono">{s.supplier_code}</td>
                  <td className="px-4 py-3">
                    <div className="font-medium">
                      {s.name}
                      {!s.is_active && (
                        <span className="ml-2 rounded bg-slate-200 px-2 py-0.5 text-xs font-normal text-slate-600">
                          {t('archivedBadge')}
                        </span>
                      )}
                    </div>
                    {s.activity && (
                      <div className="max-w-xs truncate text-xs text-slate-500" title={s.activity}>
                        {s.activity}
                      </div>
                    )}
                  </td>
                  <td className="px-4 py-3">{s.default_currency}</td>
                  <td className="px-4 py-3">
                    <div>{s.contact_name}</div>
                    <div className="text-xs text-slate-500">{s.phone}</div>
                  </td>
                  <td className="px-4 py-3 text-right">{s.item_count}</td>
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

      {/* Windows are stacked in this order: the last one is on top */}
      {profile && (
        <SupplierProfileDrawer
          supplier={profile}
          blocked={detailId !== null || editInvoice !== null || drawer !== null}
          onClose={() => setProfileId(null)}
          onEdit={() => setDrawer({ supplier: profile })}
          onOpenInvoice={setDetailId}
        />
      )}

      {detailId && (
        <InvoiceDetailDrawer
          invoiceId={detailId}
          onClose={() => setDetailId(null)}
          onChanged={() => void load()}
          onEdit={(inv) => {
            setDetailId(null)
            setEditInvoice(inv)
          }}
        />
      )}

      {editInvoice && (
        <InvoiceDrawer
          invoice={editInvoice}
          onClose={() => setEditInvoice(null)}
          onSaved={() => {
            const id = editInvoice.id
            setEditInvoice(null)
            void load()
            setDetailId(id) // back to the invoice details
          }}
        />
      )}

      {drawer && (
        <SupplierDrawer
          supplier={drawer.supplier}
          onClose={() => setDrawer(null)}
          onSaved={() => {
            setDrawer(null)
            void load()
          }}
        />
      )}
    </div>
  )
}