import { useEffect, useState, type FormEvent, type ReactNode } from 'react'
import { supabase } from '../lib/supabase'
import { formatMoney, parseAmount, todayISO } from '../lib/format'
import { PAYMENT_METHODS, type LedgerRow, type PaymentMethod, type PaymentRow } from '../lib/types'
import { useI18n } from '../i18n/I18nProvider'
import type { Dictionary } from '../i18n/translations'

interface Props {
  invoice: LedgerRow
  payment: PaymentRow | null // null = new payment
  quick?: boolean // true = "Mark as paid" shortcut (only changes the title)
  onClose: () => void
  onSaved: () => void
}

const inputCls =
  'w-full rounded-md border border-slate-300 px-3 py-2 text-sm outline-none focus:border-blue-500'

// Work in thousandths so that 0.1 + 0.2 style rounding errors never matter
const toMillimes = (n: number): number => Math.round(n * 1000)

function Field({ label, children }: { label: string; children: ReactNode }): React.JSX.Element {
  return (
    <label className="block">
      <span className="mb-1 block text-sm font-medium text-slate-700">{label}</span>
      {children}
    </label>
  )
}

export default function PaymentModal({
  invoice,
  payment,
  quick = false,
  onClose,
  onSaved
}: Props): React.JSX.Element {
  const { t, locale } = useI18n()
  const cur = invoice.currency
  const decimals = cur === 'TND' ? 3 : 2

  // Largest amount this payment may have = what is still owed (+ its own amount when editing)
  const maxAllowed =
    (toMillimes(Number(invoice.remaining_amount)) +
      (payment ? toMillimes(Number(payment.amount_paid)) : 0)) /
    1000

  const [date, setDate] = useState(payment?.payment_date ?? todayISO())
  const [amount, setAmount] = useState(
    (payment ? Number(payment.amount_paid) : maxAllowed).toFixed(decimals)
  )
  const [method, setMethod] = useState<PaymentMethod>(payment?.method ?? 'CHEQUE')
  const [reference, setReference] = useState(payment?.reference_number ?? '')
  const [notes, setNotes] = useState(payment?.notes ?? '')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  function mapError(message: string): string {
    if (message.includes('Overpayment')) return t('errOverpayment')
    if (message.includes('voided')) return t('errVoidedPayment')
    if (message.includes('2 decimals')) return t('errPrecision')
    return message
  }

  async function onSubmit(e: FormEvent): Promise<void> {
    e.preventDefault()
    setError(null)

    const parsed = parseAmount(amount, cur)
    if (parsed === null) return setError(t('errAmount'))
    if (toMillimes(parsed) > toMillimes(maxAllowed)) {
      return setError(
        `${t('errOverpayment')} (${t('maxAllowed')}: ${formatMoney(maxAllowed, cur, locale)})`
      )
    }

    setBusy(true)
    const payload = {
      invoice_id: invoice.id,
      payment_date: date,
      amount_paid: parsed,
      method,
      reference_number: reference.trim() === '' ? null : reference.trim(),
      notes: notes.trim() === '' ? null : notes.trim()
    }

    if (payment) {
      const { data, error: err } = await supabase
        .from('invoice_payments')
        .update(payload)
        .eq('id', payment.id)
        .select('id')
      setBusy(false)
      if (err) return setError(mapError(err.message))
      if (!data || data.length === 0) return setError(t('errNotAllowed'))
    } else {
      const { error: err } = await supabase.from('invoice_payments').insert(payload)
      setBusy(false)
      if (err) return setError(mapError(err.message))
    }
    onSaved()
  }

  const title = payment ? t('editPayment') : quick ? t('markAsPaid') : t('newPayment')

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/50" onClick={onClose} />
      <form
        onSubmit={onSubmit}
        className="relative w-[28rem] max-w-full rounded-xl bg-white shadow-2xl"
      >
        <div className="border-b px-6 py-4">
          <h3 className="text-lg font-bold text-slate-800">{title}</h3>
          <p className="text-sm text-slate-500">
            {invoice.supplier_name} · {invoice.invoice_number}
          </p>
          <p className="mt-1 text-sm">
            {t('colRemaining')}:{' '}
            <span className="font-bold text-red-600">
              {formatMoney(invoice.remaining_amount, cur, locale)}
            </span>
          </p>
        </div>

        <div className="space-y-4 px-6 py-4">
          <div className="grid grid-cols-2 gap-3">
            <Field label={t('paymentDate')}>
              <input
                type="date"
                required
                value={date}
                onChange={(e) => setDate(e.target.value)}
                className={inputCls}
              />
            </Field>
            <Field label={`${t('paymentAmount')} (${cur})`}>
              <input
                required
                autoFocus
                inputMode="decimal"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                onFocus={(e) => e.target.select()}
                className={`${inputCls} text-right`}
              />
            </Field>
          </div>
          <p className="-mt-2 text-right text-xs text-slate-500">
            {t('maxAllowed')}: {formatMoney(maxAllowed, cur, locale)}
          </p>

          <div className="grid grid-cols-2 gap-3">
            <Field label={t('paymentMethod')}>
              <select
                value={method}
                onChange={(e) => setMethod(e.target.value as PaymentMethod)}
                className={inputCls}
              >
                {PAYMENT_METHODS.map((m) => (
                  <option key={m} value={m}>
                    {t(`method_${m}` as keyof Dictionary)}
                  </option>
                ))}
              </select>
            </Field>
            <Field label={t('referenceNumber')}>
              <input
                value={reference}
                onChange={(e) => setReference(e.target.value)}
                placeholder="0000269"
                className={inputCls}
              />
            </Field>
          </div>

          <Field label={t('notes')}>
            <textarea
              rows={2}
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              className={inputCls}
            />
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
            className="rounded-md bg-green-600 px-4 py-2 text-sm font-medium text-white hover:bg-green-700 disabled:opacity-60"
          >
            {busy ? t('saving') : t('save')}
          </button>
        </div>
      </form>
    </div>
  )
}