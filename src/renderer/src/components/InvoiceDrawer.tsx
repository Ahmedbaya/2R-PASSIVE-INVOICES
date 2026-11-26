import { useEffect, useState, type FormEvent, type ReactNode } from 'react'
import { supabase } from '../lib/supabase'
import { CURRENCIES, parseAmount, todayISO, type Currency } from '../lib/format'
import { DOC_TYPES, type DocType, type LedgerRow, type SupplierOption } from '../lib/types'
import { useI18n } from '../i18n/I18nProvider'
import type { Dictionary } from '../i18n/translations'

interface Props {
  invoice: LedgerRow | null // null = creating a new document
  onClose: () => void
  onSaved: () => void
}

const inputCls =
  'w-full rounded-md border border-slate-300 px-3 py-2 text-sm outline-none focus:border-blue-500 disabled:bg-slate-100'

function Field({ label, children }: { label: string; children: ReactNode }): React.JSX.Element {
  return (
    <label className="block">
      <span className="mb-1 block text-sm font-medium text-slate-700">{label}</span>
      {children}
    </label>
  )
}

export default function InvoiceDrawer({ invoice, onClose, onSaved }: Props): React.JSX.Element {
  const { t } = useI18n()
  const isNew = invoice === null
  const isVoid = invoice?.is_void ?? false
  const hasPayments = (invoice?.payment_count ?? 0) > 0

  const [suppliers, setSuppliers] = useState<SupplierOption[]>([])
  const [supplierId, setSupplierId] = useState(invoice?.supplier_id ?? '')
  const [number, setNumber] = useState(invoice?.invoice_number ?? '')
  const [docType, setDocType] = useState<DocType>(invoice?.doc_type ?? 'INVOICE')
  const [invoiceDate, setInvoiceDate] = useState(invoice?.invoice_date ?? todayISO())
  const [dueDate, setDueDate] = useState(invoice?.due_date ?? todayISO())
  const [currency, setCurrency] = useState<Currency>(invoice?.currency ?? 'TND')
  const [amount, setAmount] = useState(
    invoice ? Number(invoice.invoice_amount).toFixed(invoice.currency === 'TND' ? 3 : 2) : ''
  )
  const [notes, setNotes] = useState(invoice?.notes ?? '')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    supabase
      .from('suppliers')
      .select('id, supplier_code, name, default_currency, is_active')
      .order('supplier_code')
      .then(({ data }) => setSuppliers((data as SupplierOption[]) ?? []))
  }, [])

  // Escape closes the drawer
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  function onSupplierChange(id: string): void {
    setSupplierId(id)
    // New document: pre-select the supplier's usual currency
    if (isNew) {
      const s = suppliers.find((x) => x.id === id)
      if (s) setCurrency(s.default_currency)
    }
  }

  function onInvoiceDateChange(value: string): void {
    setInvoiceDate(value)
    if (dueDate < value) setDueDate(value)
  }

  function mapError(err: { code?: string; message: string }): string {
    if (err.code === '23505') return t('errDuplicate')
    if (err.message.includes('amount_precision')) return t('errPrecision')
    if (err.message.includes('due_not_before_issue')) return t('errDates')
    return err.message
  }

  async function onSubmit(e: FormEvent): Promise<void> {
    e.preventDefault()
    setError(null)

    if (!supplierId) return setError(t('errSupplier'))
    if (dueDate < invoiceDate) return setError(t('errDates'))
    const parsed = parseAmount(amount, currency)
    if (parsed === null) return setError(t('errAmount'))

    setBusy(true)
    const payload = {
      supplier_id: supplierId,
      invoice_number: number.trim(),
      doc_type: docType,
      invoice_date: invoiceDate,
      due_date: dueDate,
      currency,
      invoice_amount: parsed,
      notes: notes.trim() === '' ? null : notes.trim()
    }

    const res = isNew
      ? await supabase.from('purchase_invoices').insert(payload)
      : await supabase.from('purchase_invoices').update(payload).eq('id', invoice.id)

    setBusy(false)
    if (res.error) setError(mapError(res.error))
    else onSaved()
  }

  async function setVoid(makeVoid: boolean): Promise<void> {
    if (!invoice) return
    if (makeVoid && !window.confirm(t('voidConfirm'))) return
    setBusy(true)
    setError(null)
    const { error: err } = await supabase
      .from('purchase_invoices')
      .update({ is_void: makeVoid })
      .eq('id', invoice.id)
    setBusy(false)
    if (err) setError(mapError(err))
    else onSaved()
  }

  const options = suppliers.filter((s) => s.is_active || s.id === supplierId)

  return (
    <div className="fixed inset-0 z-50 flex justify-end">
      <div className="absolute inset-0 bg-black/40" onClick={onClose} />
      <form
        onSubmit={onSubmit}
        className="relative flex h-full w-[30rem] max-w-full flex-col bg-white shadow-xl"
      >
        <div className="flex items-center justify-between border-b px-6 py-4">
          <h3 className="text-lg font-bold text-slate-800">
            {isNew ? t('newInvoice') : t('editInvoice')}
          </h3>
          <button
            type="button"
            onClick={onClose}
            aria-label={t('close')}
            className="rounded px-2 py-1 text-slate-500 hover:bg-slate-100"
          >
            ✕
          </button>
        </div>

        <div className="flex-1 space-y-4 overflow-auto px-6 py-4">
          <fieldset disabled={isVoid} className="space-y-4">
            <Field label={t('supplier')}>
              <select
                required
                autoFocus
                value={supplierId}
                onChange={(e) => onSupplierChange(e.target.value)}
                className={inputCls}
              >
                <option value="">{t('selectSupplier')}</option>
                {options.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.supplier_code} — {s.name}
                  </option>
                ))}
              </select>
            </Field>

            <div className="grid grid-cols-2 gap-3">
              <Field label={t('invoiceNumber')}>
                <input
                  required
                  value={number}
                  onChange={(e) => setNumber(e.target.value)}
                  className={inputCls}
                />
              </Field>
              <Field label={t('documentType')}>
                <select
                  value={docType}
                  onChange={(e) => setDocType(e.target.value as DocType)}
                  className={inputCls}
                >
                  {DOC_TYPES.map((d) => (
                    <option key={d} value={d}>
                      {t(`type_${d}` as keyof Dictionary)}
                    </option>
                  ))}
                </select>
              </Field>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <Field label={t('invoiceDate')}>
                <input
                  type="date"
                  required
                  value={invoiceDate}
                  onChange={(e) => onInvoiceDateChange(e.target.value)}
                  className={inputCls}
                />
              </Field>
              <Field label={t('dueDate')}>
                <input
                  type="date"
                  required
                  min={invoiceDate}
                  value={dueDate}
                  onChange={(e) => setDueDate(e.target.value)}
                  className={inputCls}
                />
              </Field>
            </div>

            <div className="grid grid-cols-3 gap-3">
              <Field label={t('currency')}>
                <select
                  value={currency}
                  disabled={!isNew && hasPayments}
                  onChange={(e) => setCurrency(e.target.value as Currency)}
                  className={inputCls}
                >
                  {CURRENCIES.map((c) => (
                    <option key={c} value={c}>
                      {c}
                    </option>
                  ))}
                </select>
              </Field>
              <div className="col-span-2">
                <Field label={t('amount')}>
                  <input
                    required
                    inputMode="decimal"
                    placeholder={currency === 'TND' ? '0.000' : '0.00'}
                    value={amount}
                    onChange={(e) => setAmount(e.target.value)}
                    className={`${inputCls} text-right`}
                  />
                </Field>
              </div>
            </div>
            {!isNew && hasPayments && (
              <p className="text-xs text-slate-500">{t('currencyLocked')}</p>
            )}

            <Field label={t('notes')}>
              <textarea
                rows={3}
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                className={inputCls}
              />
            </Field>
          </fieldset>

          {!isNew && (
            <div className="rounded-md bg-slate-50 p-3 text-xs text-slate-600">
              <p className="mb-2">{isVoid ? t('voidedHint') : t('voidHint')}</p>
              {isVoid ? (
                <button
                  type="button"
                  onClick={() => setVoid(false)}
                  disabled={busy}
                  className="rounded-md border border-slate-300 bg-white px-3 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-100 disabled:opacity-60"
                >
                  {t('restoreDocument')}
                </button>
              ) : (
                <button
                  type="button"
                  onClick={() => setVoid(true)}
                  disabled={busy || hasPayments}
                  className="rounded-md border border-red-300 bg-white px-3 py-1.5 text-sm font-medium text-red-700 hover:bg-red-50 disabled:opacity-50"
                >
                  {t('voidDocument')}
                </button>
              )}
              {!isVoid && hasPayments && <p className="mt-2">{t('voidLocked')}</p>}
            </div>
          )}

          {error && <p className="rounded bg-red-50 p-2 text-sm text-red-700">{error}</p>}
        </div>

        <div className="flex justify-end gap-3 border-t px-6 py-4">
          <button
            type="button"
            onClick={onClose}
            className="rounded-md border border-slate-300 px-4 py-2 text-sm hover:bg-slate-50"
          >
            {t('cancel')}
          </button>
          <button
            type="submit"
            disabled={busy || isVoid}
            className="rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-60"
          >
            {busy ? t('saving') : t('save')}
          </button>
        </div>
      </form>
    </div>
  )
}