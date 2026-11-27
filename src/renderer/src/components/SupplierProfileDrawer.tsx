import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react'
import { supabase } from '../lib/supabase'
import { CURRENCIES, formatDate, formatMoney, type Currency } from '../lib/format'
import type { LedgerRow, SupplierItem, SupplierRow } from '../lib/types'
import { useI18n } from '../i18n/I18nProvider'
import type { Dictionary } from '../i18n/translations'
import StatusBadge from './StatusBadge'
import SupplierItemModal from './SupplierItemModal'

type Tab = 'profile' | 'items' | 'invoices'

interface Props {
  supplier: SupplierRow
  blocked: boolean // another window is open on top: Escape must close that one first
  onClose: () => void
  onEdit: () => void
  onOpenInvoice: (id: string) => void
}

function Info({ label, children }: { label: string; children: ReactNode }): React.JSX.Element {
  return (
    <div>
      <dt className="text-xs uppercase text-slate-500">{label}</dt>
      <dd className="text-sm font-medium text-slate-800">
        {children || <span className="text-slate-400">—</span>}
      </dd>
    </div>
  )
}

export default function SupplierProfileDrawer({
  supplier,
  blocked,
  onClose,
  onEdit,
  onOpenInvoice
}: Props): React.JSX.Element {
  const { t, locale } = useI18n()
  const [tab, setTab] = useState<Tab>('profile')
  const [items, setItems] = useState<SupplierItem[]>([])
  const [rows, setRows] = useState<LedgerRow[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [itemSearch, setItemSearch] = useState('')
  const [itemModal, setItemModal] = useState<{ item: SupplierItem | null } | null>(null)

  const load = useCallback(async () => {
    const [it, inv] = await Promise.all([
      supabase
        .from('supplier_items')
        .select('*')
        .eq('supplier_id', supplier.id)
        .order('name')
        .range(0, 999),
      supabase
        .from('purchase_invoices_ledger')
        .select('*')
        .eq('supplier_id', supplier.id)
        .neq('status', 'VOID')
        .order('invoice_date', { ascending: false })
        .range(0, 999)
    ])
    if (it.error || inv.error) {
      setError((it.error ?? inv.error)!.message)
    } else {
      setError(null)
      setItems(it.data as SupplierItem[])
      setRows(inv.data as LedgerRow[])
    }
    setLoading(false)
  }, [supplier.id])

  // Load, and refresh automatically when another PC changes items, invoices or payments
  useEffect(() => {
    void load()
    const channel = supabase.channel(`supplier-profile-${crypto.randomUUID()}`)
    for (const table of ['supplier_items', 'purchase_invoices', 'invoice_payments']) {
      channel.on('postgres_changes', { event: '*', schema: 'public', table }, () => {
        void load()
      })
    }
    channel.subscribe()
    return () => {
      void supabase.removeChannel(channel)
    }
  }, [load])

  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape' && !blocked && !itemModal) onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [blocked, itemModal, onClose])

  const totals = useMemo(() => {
    const acc: Record<Currency, { invoiced: number; paid: number; remaining: number; count: number }> = {
      TND: { invoiced: 0, paid: 0, remaining: 0, count: 0 },
      EUR: { invoiced: 0, paid: 0, remaining: 0, count: 0 },
      USD: { invoiced: 0, paid: 0, remaining: 0, count: 0 }
    }
    for (const r of rows) {
      const a = acc[r.currency]
      a.invoiced += Number(r.invoice_amount)
      a.paid += Number(r.total_paid)
      a.remaining += Number(r.remaining_amount)
      a.count++
    }
    return acc
  }, [rows])

  const shownItems = useMemo(() => {
    const q = itemSearch.trim().toLowerCase()
    if (!q) return items
    return items.filter((i) => [i.name, i.reference, i.unit, i.notes].some((v) => v?.toLowerCase().includes(q)))
  }, [items, itemSearch])

  async function removeItem(item: SupplierItem): Promise<void> {
    if (!window.confirm(t('deleteItemConfirm'))) return
    setError(null)
    const { data, error: err } = await supabase
      .from('supplier_items')
      .delete()
      .eq('id', item.id)
      .select('id')
    if (err) return setError(err.message)
    if (!data || data.length === 0) return setError(t('errNotAllowed'))
    void load()
  }

  const tabBtn = (id: Tab, label: string): React.JSX.Element => (
    <button
      key={id}
      onClick={() => setTab(id)}
      className={`border-b-2 px-4 py-2 text-sm font-medium ${
        tab === id
          ? 'border-blue-600 text-blue-700'
          : 'border-transparent text-slate-500 hover:text-slate-800'
      }`}
    >
      {label}
    </button>
  )

  const openBalances = CURRENCIES.filter((c) => totals[c].remaining > 0)

  return (
    <div className="fixed inset-0 z-50 flex justify-end">
      <div className="absolute inset-0 bg-black/40" onClick={onClose} />
      <div className="relative flex h-full w-[46rem] max-w-full flex-col bg-white shadow-xl">
        {/* Header */}
        <div className="flex items-start justify-between gap-3 border-b px-6 py-4">
          <div className="min-w-0">
            <p className="text-xs uppercase text-slate-500">{t('supplierProfile')}</p>
            <h3 className="truncate text-xl font-bold text-slate-800">
              {supplier.name}
              {!supplier.is_active && (
                <span className="ml-2 rounded bg-slate-200 px-2 py-0.5 align-middle text-xs font-normal text-slate-600">
                  {t('archivedBadge')}
                </span>
              )}
            </h3>
            <p className="text-sm text-slate-500">
              <span className="font-mono">{supplier.supplier_code}</span>
              {supplier.tax_id && ` · ${t('taxId')}: ${supplier.tax_id}`}
            </p>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            <button
              onClick={onEdit}
              className="rounded-md border border-slate-300 px-3 py-1.5 text-sm hover:bg-slate-50"
            >
              {t('editSupplier')}
            </button>
            <button
              onClick={onClose}
              aria-label={t('close')}
              className="rounded px-2 py-1 text-slate-500 hover:bg-slate-100"
            >
              ✕
            </button>
          </div>
        </div>

        {/* Tabs */}
        <div className="flex border-b px-4">
          {tabBtn('profile', t('tabProfile'))}
          {tabBtn('items', `${t('tabItems')} (${items.length})`)}
          {tabBtn('invoices', `${t('tabInvoices')} (${rows.length})`)}
        </div>

        <div className="flex-1 space-y-5 overflow-auto px-6 py-4">
          {loading && <p className="text-slate-500">{t('loading')}</p>}
          {error && <p className="rounded bg-red-50 p-2 text-sm text-red-700">{error}</p>}

          {/* ---------- Profile ---------- */}
          {!loading && tab === 'profile' && (
            <>
              <div>
                <h4 className="mb-2 text-sm font-bold uppercase text-slate-600">{t('activity')}</h4>
                {supplier.activity ? (
                  <p className="whitespace-pre-wrap rounded-lg bg-blue-50 p-3 text-sm text-slate-800">
                    {supplier.activity}
                  </p>
                ) : (
                  <p className="text-sm text-slate-500">{t('noActivity')}</p>
                )}
              </div>

              <div className="grid grid-cols-3 gap-3 text-center">
                <div className="rounded-lg bg-slate-50 p-3">
                  <div className="text-2xl font-bold text-slate-800">{items.length}</div>
                  <div className="text-xs uppercase text-slate-500">{t('colItems')}</div>
                </div>
                <div className="rounded-lg bg-slate-50 p-3">
                  <div className="text-2xl font-bold text-slate-800">{rows.length}</div>
                  <div className="text-xs uppercase text-slate-500">{t('documents')}</div>
                </div>
                <div className="rounded-lg bg-slate-50 p-3">
                  {openBalances.length === 0 ? (
                    <div className="text-2xl font-bold text-slate-400">—</div>
                  ) : (
                    openBalances.map((c) => (
                      <div key={c} className="text-sm font-bold text-red-600">
                        {formatMoney(totals[c].remaining, c, locale)}
                      </div>
                    ))
                  )}
                  <div className="text-xs uppercase text-slate-500">{t('colOpenBalance')}</div>
                </div>
              </div>

              <div>
                <h4 className="mb-2 text-sm font-bold uppercase text-slate-600">{t('contactDetails')}</h4>
                <dl className="grid grid-cols-2 gap-4">
                  <Info label={t('contactName')}>{supplier.contact_name}</Info>
                  <Info label={t('phone')}>{supplier.phone}</Info>
                  <Info label={t('email')}>{supplier.email}</Info>
                  <Info label={t('defaultCurrency')}>{supplier.default_currency}</Info>
                  <div className="col-span-2">
                    <Info label={t('address')}>{supplier.address}</Info>
                  </div>
                </dl>
              </div>

              {supplier.notes && (
                <p className="whitespace-pre-wrap rounded border-l-4 border-slate-300 bg-slate-50 p-3 text-sm text-slate-600">
                  {supplier.notes}
                </p>
              )}
            </>
          )}

          {/* ---------- Items purchased ---------- */}
          {!loading && tab === 'items' && (
            <>
              <div className="flex flex-wrap items-center gap-3">
                <input
                  value={itemSearch}
                  onChange={(e) => setItemSearch(e.target.value)}
                  placeholder={t('searchItems')}
                  className="min-w-0 flex-1 rounded-md border border-slate-300 px-3 py-2 text-sm outline-none focus:border-blue-500"
                />
                <button
                  onClick={() => setItemModal({ item: null })}
                  className="rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700"
                >
                  {t('addItem')}
                </button>
              </div>

              {shownItems.length === 0 ? (
                <p className="text-sm text-slate-500">{items.length === 0 ? t('noItems') : t('noResults')}</p>
              ) : (
                <table className="w-full text-left text-sm">
                  <thead className="text-xs uppercase text-slate-500">
                    <tr>
                      <th className="py-2">{t('colItem')}</th>
                      <th className="py-2">{t('colUnit')}</th>
                      <th className="py-2 text-right">{t('colUnitPrice')}</th>
                      <th />
                    </tr>
                  </thead>
                  <tbody>
                    {shownItems.map((i) => (
                      <tr key={i.id} className="border-t align-top">
                        <td className="py-2">
                          <div className="font-medium">{i.name}</div>
                          {i.reference && <div className="font-mono text-xs text-slate-500">{i.reference}</div>}
                          {i.notes && <div className="text-xs text-slate-500">{i.notes}</div>}
                        </td>
                        <td className="py-2">{i.unit}</td>
                        <td className="whitespace-nowrap py-2 text-right font-semibold">
                          {i.unit_price !== null ? formatMoney(i.unit_price, i.currency, locale) : '—'}
                        </td>
                        <td className="whitespace-nowrap py-2 text-right">
                          <button
                            onClick={() => setItemModal({ item: i })}
                            className="mr-2 text-xs text-blue-700 hover:underline"
                          >
                            {t('edit')}
                          </button>
                          <button
                            onClick={() => void removeItem(i)}
                            className="text-xs text-red-700 hover:underline"
                          >
                            {t('deleteItem')}
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </>
          )}

          {/* ---------- Invoices (statement) ---------- */}
          {!loading && tab === 'invoices' && (
            <>
              <div>
                <h4 className="mb-2 text-sm font-bold uppercase text-slate-600">{t('profTotals')}</h4>
                <div className="space-y-2">
                  {CURRENCIES.filter((c) => totals[c].count > 0).map((c) => (
                    <div key={c} className="grid grid-cols-4 gap-2 rounded-lg bg-slate-50 p-3 text-sm">
                      <div className="font-bold">
                        {c} <span className="text-xs font-normal text-slate-500">({totals[c].count})</span>
                      </div>
                      <div>
                        <div className="text-xs uppercase text-slate-500">{t('totalInvoiced')}</div>
                        {formatMoney(totals[c].invoiced, c, locale)}
                      </div>
                      <div>
                        <div className="text-xs uppercase text-slate-500">{t('totalPaid')}</div>
                        {formatMoney(totals[c].paid, c, locale)}
                      </div>
                      <div>
                        <div className="text-xs uppercase text-slate-500">{t('colRemaining')}</div>
                        <span className={totals[c].remaining > 0 ? 'font-bold text-red-600' : ''}>
                          {formatMoney(totals[c].remaining, c, locale)}
                        </span>
                      </div>
                    </div>
                  ))}
                  {rows.length === 0 && <p className="text-sm text-slate-500">{t('noInvoices')}</p>}
                </div>
              </div>

              {rows.length > 0 && (
                <div className="overflow-x-auto">
                  <table className="w-full text-left text-sm">
                    <thead className="text-xs uppercase text-slate-500">
                      <tr>
                        <th className="py-2">{t('colInvoiceDate')}</th>
                        <th className="py-2">{t('colNumber')}</th>
                        <th className="py-2">{t('colType')}</th>
                        <th className="py-2">{t('colDueDate')}</th>
                        <th className="py-2 text-right">{t('colAmount')}</th>
                        <th className="py-2 text-right">{t('colRemaining')}</th>
                        <th className="py-2">{t('colStatus')}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {rows.map((r) => {
                        const rem = Number(r.remaining_amount)
                        return (
                          <tr
                            key={r.id}
                            onClick={() => onOpenInvoice(r.id)}
                            className="cursor-pointer border-t hover:bg-blue-50"
                          >
                            <td className="whitespace-nowrap py-2">{formatDate(r.invoice_date)}</td>
                            <td className="py-2">{r.invoice_number}</td>
                            <td className="py-2 text-xs">{t(`type_${r.doc_type}` as keyof Dictionary)}</td>
                            <td className="whitespace-nowrap py-2">{formatDate(r.due_date)}</td>
                            <td className="whitespace-nowrap py-2 text-right">
                              {formatMoney(r.invoice_amount, r.currency, locale)}
                            </td>
                            <td
                              className={`whitespace-nowrap py-2 text-right ${
                                rem > 0 ? 'font-bold text-red-600' : 'text-slate-400'
                              }`}
                            >
                              {formatMoney(rem, r.currency, locale)}
                            </td>
                            <td className="py-2">
                              <StatusBadge status={r.status} />
                            </td>
                          </tr>
                        )
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </>
          )}
        </div>
      </div>

      {itemModal && (
        <SupplierItemModal
          supplierId={supplier.id}
          defaultCurrency={supplier.default_currency}
          item={itemModal.item}
          onClose={() => setItemModal(null)}
          onSaved={() => {
            setItemModal(null)
            void load()
          }}
        />
      )}
    </div>
  )
}