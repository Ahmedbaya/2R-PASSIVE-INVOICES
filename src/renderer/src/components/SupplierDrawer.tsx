import { useEffect, useState, type FormEvent, type ReactNode } from 'react'
import { supabase } from '../lib/supabase'
import { CURRENCIES, type Currency } from '../lib/format'
import type { SupplierRow } from '../lib/types'
import { useI18n } from '../i18n/I18nProvider'

interface Props {
  supplier: SupplierRow | null // null = creating a new supplier
  onClose: () => void
  onSaved: () => void
}

const inputCls =
  'w-full rounded-md border border-slate-300 px-3 py-2 text-sm outline-none focus:border-blue-500'

function Field({ label, children }: { label: string; children: ReactNode }): React.JSX.Element {
  return (
    <label className="block">
      <span className="mb-1 block text-sm font-medium text-slate-700">{label}</span>
      {children}
    </label>
  )
}

const emptyToNull = (v: string): string | null => (v.trim() === '' ? null : v.trim())

export default function SupplierDrawer({ supplier, onClose, onSaved }: Props): React.JSX.Element {
  const { t } = useI18n()
  const isNew = supplier === null

  const [code, setCode] = useState(supplier?.supplier_code ?? '')
  const [name, setName] = useState(supplier?.name ?? '')
  const [currency, setCurrency] = useState<Currency>(supplier?.default_currency ?? 'TND')
  const [contactName, setContactName] = useState(supplier?.contact_name ?? '')
  const [phone, setPhone] = useState(supplier?.phone ?? '')
  const [email, setEmail] = useState(supplier?.email ?? '')
  const [address, setAddress] = useState(supplier?.address ?? '')
  const [taxId, setTaxId] = useState(supplier?.tax_id ?? '')
  const [notes, setNotes] = useState(supplier?.notes ?? '')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // New supplier: suggest the next code (2R005, 2R006, ...). The user can still edit it.
  useEffect(() => {
    if (!isNew) return
    supabase.rpc('next_supplier_code').then(({ data }) => {
      if (typeof data === 'string') setCode((current) => current || data)
    })
  }, [isNew])

  // Escape closes the drawer
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  async function onSubmit(e: FormEvent): Promise<void> {
    e.preventDefault()
    setBusy(true)
    setError(null)

    const payload = {
      supplier_code: code.trim().toUpperCase(),
      name: name.trim(),
      default_currency: currency,
      contact_name: emptyToNull(contactName),
      phone: emptyToNull(phone),
      email: emptyToNull(email),
      address: emptyToNull(address),
      tax_id: emptyToNull(taxId),
      notes: emptyToNull(notes)
    }

    const res = isNew
      ? await supabase.from('suppliers').insert(payload)
      : await supabase.from('suppliers').update(payload).eq('id', supplier.id)

    setBusy(false)
    if (res.error) {
      setError(res.error.code === '23505' ? t('codeExists') : res.error.message)
    } else {
      onSaved()
    }
  }

  async function toggleArchive(): Promise<void> {
    if (!supplier) return
    setBusy(true)
    setError(null)
    const { error: err } = await supabase
      .from('suppliers')
      .update({ is_active: !supplier.is_active })
      .eq('id', supplier.id)
    setBusy(false)
    if (err) setError(err.message)
    else onSaved()
  }

  return (
    <div className="fixed inset-0 z-50 flex justify-end">
      <div className="absolute inset-0 bg-black/40" onClick={onClose} />
      <form
        onSubmit={onSubmit}
        className="relative flex h-full w-[28rem] max-w-full flex-col bg-white shadow-xl"
      >
        <div className="flex items-center justify-between border-b px-6 py-4">
          <h3 className="text-lg font-bold text-slate-800">
            {isNew ? t('newSupplier') : t('editSupplier')}
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
          <div className="grid grid-cols-3 gap-3">
            <Field label={t('supplierCode')}>
              <input
                required
                value={code}
                onChange={(e) => setCode(e.target.value)}
                className={inputCls}
              />
            </Field>
            <div className="col-span-2">
              <Field label={t('supplierName')}>
                <input
                  required
                  autoFocus
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  className={inputCls}
                />
              </Field>
            </div>
          </div>

          <Field label={t('defaultCurrency')}>
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

          <Field label={t('contactName')}>
            <input
              value={contactName}
              onChange={(e) => setContactName(e.target.value)}
              className={inputCls}
            />
          </Field>

          <div className="grid grid-cols-2 gap-3">
            <Field label={t('phone')}>
              <input value={phone} onChange={(e) => setPhone(e.target.value)} className={inputCls} />
            </Field>
            <Field label={t('email')}>
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className={inputCls}
              />
            </Field>
          </div>

          <Field label={t('address')}>
            <input
              value={address}
              onChange={(e) => setAddress(e.target.value)}
              className={inputCls}
            />
          </Field>

          <Field label={t('taxId')}>
            <input value={taxId} onChange={(e) => setTaxId(e.target.value)} className={inputCls} />
          </Field>

          <Field label={t('notes')}>
            <textarea
              rows={3}
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              className={inputCls}
            />
          </Field>

          {!isNew && (
            <div className="rounded-md bg-slate-50 p-3 text-xs text-slate-600">
              <p className="mb-2">{t('archiveHint')}</p>
              <button
                type="button"
                onClick={toggleArchive}
                disabled={busy}
                className="rounded-md border border-slate-300 bg-white px-3 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-100 disabled:opacity-60"
              >
                {supplier.is_active ? t('archive') : t('restore')}
              </button>
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