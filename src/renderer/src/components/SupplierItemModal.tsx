import { useEffect, useState, type FormEvent, type ReactNode } from 'react'
import { supabase } from '../lib/supabase'
import { CURRENCIES, parseAmount, type Currency } from '../lib/format'
import type { SupplierItem } from '../lib/types'
import { useI18n } from '../i18n/I18nProvider'

interface Props {
  supplierId: string
  defaultCurrency: Currency
  item: SupplierItem | null // null = new item
  onClose: () => void
  onSaved: () => void
}

const inputCls =
  'w-full rounded-md border border-slate-300 px-3 py-2 text-sm outline-none focus:border-blue-500'

const emptyToNull = (v: string): string | null => (v.trim() === '' ? null : v.trim())

function Field({ label, children }: { label: string; children: ReactNode }): React.JSX.Element {
  return (
    <label className="block">
      <span className="mb-1 block text-sm font-medium text-slate-700">{label}</span>
      {children}
    </label>
  )
}

export default function SupplierItemModal({
  supplierId,
  defaultCurrency,
  item,
  onClose,
  onSaved
}: Props): React.JSX.Element {
  const { t } = useI18n()
  const [name, setName] = useState(item?.name ?? '')
  const [reference, setReference] = useState(item?.reference ?? '')
  const [unit, setUnit] = useState(item?.unit ?? '')
  const [currency, setCurrency] = useState<Currency>(item?.currency ?? defaultCurrency)
  const [price, setPrice] = useState(
    item && item.unit_price !== null
      ? Number(item.unit_price).toFixed(item.currency === 'TND' ? 3 : 2)
      : ''
  )
  const [notes, setNotes] = useState(item?.notes ?? '')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  async function onSubmit(e: FormEvent): Promise<void> {
    e.preventDefault()
    setError(null)

    // The price is optional; when typed it must be valid for the currency
    let unitPrice: number | null = null
    if (price.trim() !== '') {
      const parsed = parseAmount(price, currency)
      if (parsed === null) return setError(t('errAmount'))
      unitPrice = parsed
    }

    setBusy(true)
    const payload = {
      supplier_id: supplierId,
      name: name.trim(),
      reference: emptyToNull(reference),
      unit: emptyToNull(unit),
      unit_price: unitPrice,
      currency,
      notes: emptyToNull(notes)
    }

    let failure: string | null = null
    if (item) {
      const { data, error: err } = await supabase
        .from('supplier_items')
        .update(payload)
        .eq('id', item.id)
        .select('id')
      if (err) failure = err.code === '23505' ? t('errItemExists') : err.message
      else if (!data || data.length === 0) failure = t('errNotAllowed')
    } else {
      const { error: err } = await supabase.from('supplier_items').insert(payload)
      if (err) failure = err.code === '23505' ? t('errItemExists') : err.message
    }

    setBusy(false)
    if (failure) setError(failure)
    else onSaved()
  }

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/50" onClick={onClose} />
      <form onSubmit={onSubmit} className="relative w-[30rem] max-w-full rounded-xl bg-white shadow-2xl">
        <div className="border-b px-6 py-4">
          <h3 className="text-lg font-bold text-slate-800">{item ? t('editItem') : t('newItem')}</h3>
        </div>

        <div className="space-y-4 px-6 py-4">
          <Field label={t('itemName')}>
            <input
              required
              autoFocus
              value={name}
              onChange={(e) => setName(e.target.value)}
              className={inputCls}
            />
          </Field>

          <div className="grid grid-cols-2 gap-3">
            <Field label={t('itemReference')}>
              <input value={reference} onChange={(e) => setReference(e.target.value)} className={inputCls} />
            </Field>
            <Field label={t('itemUnit')}>
              <input
                value={unit}
                placeholder={t('itemUnitPlaceholder')}
                onChange={(e) => setUnit(e.target.value)}
                className={inputCls}
              />
            </Field>
          </div>

          <div className="grid grid-cols-3 gap-3">
            <Field label={t('currency')}>
              <select
                value={currency}
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
              <Field label={t('itemUnitPrice')}>
                <input
                  inputMode="decimal"
                  placeholder={currency === 'TND' ? '0.000' : '0.00'}
                  value={price}
                  onChange={(e) => setPrice(e.target.value)}
                  className={`${inputCls} text-right`}
                />
              </Field>
            </div>
          </div>

          <Field label={t('notes')}>
            <textarea rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} className={inputCls} />
          </Field>

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
            disabled={busy}
            className="rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-60"
          >
            {busy ? t('saving') : t('save')}
          </button>
        </div>
      </form>
    </div>
  )
}