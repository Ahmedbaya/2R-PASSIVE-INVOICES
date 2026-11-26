import { useCallback, useEffect, useState, type ReactNode } from 'react'
import { supabase } from '../lib/supabase'
import { formatDate, formatMoney } from '../lib/format'
import type { LedgerRow, PaymentRow } from '../lib/types'
import { useI18n } from '../i18n/I18nProvider'
import type { Dictionary } from '../i18n/translations'
import StatusBadge from './StatusBadge'
import PaymentModal from './PaymentModal'
import AttachmentSection from './AttachmentSection'

interface Props {
  invoiceId: string
  onClose: () => void
  onEdit: (invoice: LedgerRow) => void
  onChanged: () => void // tells the list behind to refresh
}

function Info({ label, children }: { label: string; children: ReactNode }): React.JSX.Element {
  return (
    <div>
      <dt className="text-xs uppercase text-slate-500">{label}</dt>
      <dd className="text-sm font-medium text-slate-800">{children}</dd>
    </div>
  )
}

export default function InvoiceDetailDrawer({
  invoiceId,
  onClose,
  onEdit,
  onChanged
}: Props): React.JSX.Element {
  const { t, locale } = useI18n()
  const [invoice, setInvoice] = useState<LedgerRow | null>(null)
  const [payments, setPayments] = useState<PaymentRow[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [modal, setModal] = useState<{ payment: PaymentRow | null; quick: boolean } | null>(null)
  const [previewOpen, setPreviewOpen] = useState(false)

  const load = useCallback(async () => {
    const [inv, pay] = await Promise.all([
      supabase.from('purchase_invoices_ledger').select('*').eq('id', invoiceId).single(),
      supabase
        .from('invoice_payments')
        .select('*')
        .eq('invoice_id', invoiceId)
        .order('payment_date')
        .order('created_at')
    ])
    if (inv.error || pay.error) {
      setError((inv.error ?? pay.error)!.message)
    } else {
      setError(null)
      setInvoice(inv.data as LedgerRow)
      setPayments(pay.data as PaymentRow[])
    }
    setLoading(false)
  }, [invoiceId])

  // Load, and refresh automatically when another PC changes this invoice or its payments
  useEffect(() => {
    load()
    const channel = supabase.channel(`invoice-detail-${crypto.randomUUID()}`)
    for (const table of ['purchase_invoices', 'invoice_payments']) {
      channel.on('postgres_changes', { event: '*', schema: 'public', table }, () => {
        load()
      })
    }
    channel.subscribe()
    return () => {
      supabase.removeChannel(channel)
    }
  }, [load])

  // Escape closes the drawer (but not while the payment window or the preview is open)
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape' && !modal && !previewOpen) onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [modal, previewOpen, onClose])

  async function removePayment(p: PaymentRow): Promise<void> {
    if (!window.confirm(t('deletePaymentConfirm'))) return
    setBusy(true)
    setError(null)
    const { data, error: err } = await supabase
      .from('invoice_payments')
      .delete()
      .eq('id', p.id)
      .select('id')
    setBusy(false)
    if (err) return setError(err.message)
    if (!data || data.length === 0) return setError(t('errNotAllowed'))
    await load()
    onChanged()
  }

  const remaining = Number(invoice?.remaining_amount ?? 0)
  const canPay = !!invoice && !invoice.is_void && remaining > 0

  return (
    <div className="fixed inset-0 z-50 flex justify-end">
      <div className="absolute inset-0 bg-black/40" onClick={onClose} />
      <div className="relative flex h-full w-[36rem] max-w-full flex-col bg-white shadow-xl">
        <div className="flex items-start justify-between border-b px-6 py-4">
          <div>
            <div className="flex items-center gap-3">
              <h3 className="text-lg font-bold text-slate-800">{invoice?.invoice_number ?? '…'}</h3>
              {invoice && <StatusBadge status={invoice.status} />}
            </div>
            {invoice && (
              <p className="text-sm text-slate-500">
                {invoice.supplier_name} · <span className="font-mono">{invoice.supplier_code}</span>
              </p>
            )}
          </div>
          <button
            onClick={onClose}
            aria-label={t('close')}
            className="rounded px-2 py-1 text-slate-500 hover:bg-slate-100"
          >
            ✕
          </button>
        </div>

        <div className="flex-1 space-y-5 overflow-auto px-6 py-4">
          {loading && <p className="text-slate-500">{t('loading')}</p>}
          {error && <p className="rounded bg-red-50 p-2 text-sm text-red-700">{error}</p>}

          {invoice && (
            <>
              <dl className="grid grid-cols-3 gap-4">
                <Info label={t('documentType')}>
                  {t(`type_${invoice.doc_type}` as keyof Dictionary)}
                </Info>
                <Info label={t('invoiceDate')}>{formatDate(invoice.invoice_date)}</Info>
                <Info label={t('dueDate')}>{formatDate(invoice.due_date)}</Info>
              </dl>

              <div className="grid grid-cols-3 gap-3 rounded-lg bg-slate-50 p-4 text-center">
                <div>
                  <div className="text-xs uppercase text-slate-500">{t('colAmount')}</div>
                  <div className="font-semibold">
                    {formatMoney(invoice.invoice_amount, invoice.currency, locale)}
                  </div>
                </div>
                <div>
                  <div className="text-xs uppercase text-slate-500">{t('colPaid')}</div>
                  <div className="font-semibold">
                    {formatMoney(invoice.total_paid, invoice.currency, locale)}
                  </div>
                </div>
                <div>
                  <div className="text-xs uppercase text-slate-500">{t('colRemaining')}</div>
                  <div
                    className={
                      remaining > 0 && !invoice.is_void
                        ? 'font-bold text-red-600'
                        : 'font-semibold text-slate-500'
                    }
                  >
                    {formatMoney(remaining, invoice.currency, locale)}
                  </div>
                </div>
              </div>

              {invoice.notes && (
                <p className="whitespace-pre-wrap rounded border-l-4 border-slate-300 bg-slate-50 p-3 text-sm text-slate-600">
                  {invoice.notes}
                </p>
              )}

              <div className="flex flex-wrap gap-2">
                {canPay && (
                  <button
                    onClick={() => setModal({ payment: null, quick: true })}
                    className="rounded-md bg-green-600 px-4 py-2 text-sm font-medium text-white hover:bg-green-700"
                  >
                    ✓ {t('markAsPaid')}
                  </button>
                )}
                {canPay && (
                  <button
                    onClick={() => setModal({ payment: null, quick: false })}
                    className="rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700"
                  >
                    {t('addPayment')}
                  </button>
                )}
                <button
                  onClick={() => onEdit(invoice)}
                  className="rounded-md border border-slate-300 px-4 py-2 text-sm hover:bg-slate-50"
                >
                  {t('editInvoice')}
                </button>
              </div>

              {invoice.is_void && (
                <p className="rounded bg-slate-100 p-2 text-sm text-slate-600">{t('voidedHint')}</p>
              )}

              <AttachmentSection
                invoice={invoice}
                onChanged={async () => {
                  await load()
                  onChanged()
                }}
                onPreviewChange={setPreviewOpen}
              />

              <div>
                <h4 className="mb-2 text-sm font-bold uppercase text-slate-600">
                  {t('paymentHistory')}
                </h4>
                {payments.length === 0 ? (
                  <p className="text-sm text-slate-500">{t('noPayments')}</p>
                ) : (
                  <table className="w-full text-left text-sm">
                    <thead className="text-xs uppercase text-slate-500">
                      <tr>
                        <th className="py-2">{t('paymentDate')}</th>
                        <th className="py-2">{t('colMethod')}</th>
                        <th className="py-2">{t('colReference')}</th>
                        <th className="py-2 text-right">{t('colAmount')}</th>
                        <th />
                      </tr>
                    </thead>
                    <tbody>
                      {payments.map((p) => (
                        <tr key={p.id} className="border-t align-top">
                          <td className="whitespace-nowrap py-2">{formatDate(p.payment_date)}</td>
                          <td className="py-2">{t(`method_${p.method}` as keyof Dictionary)}</td>
                          <td className="py-2">
                            <div className="font-mono">{p.reference_number}</div>
                            {p.notes && <div className="text-xs text-slate-500">{p.notes}</div>}
                          </td>
                          <td className="whitespace-nowrap py-2 text-right font-semibold">
                            {formatMoney(p.amount_paid, invoice.currency, locale)}
                          </td>
                          <td className="whitespace-nowrap py-2 text-right">
                            {!invoice.is_void && (
                              <>
                                <button
                                  onClick={() => setModal({ payment: p, quick: false })}
                                  className="mr-2 text-xs text-blue-700 hover:underline"
                                >
                                  {t('edit')}
                                </button>
                                <button
                                  onClick={() => removePayment(p)}
                                  disabled={busy}
                                  className="text-xs text-red-700 hover:underline disabled:opacity-50"
                                >
                                  {t('deletePayment')}
                                </button>
                              </>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </div>
            </>
          )}
        </div>
      </div>

      {modal && invoice && (
        <PaymentModal
          invoice={invoice}
          payment={modal.payment}
          quick={modal.quick}
          onClose={() => setModal(null)}
          onSaved={async () => {
            setModal(null)
            await load()
            onChanged()
          }}
        />
      )}
    </div>
  )
}