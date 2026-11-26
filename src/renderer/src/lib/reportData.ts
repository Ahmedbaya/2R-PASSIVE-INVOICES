import { supabase } from './supabase'
import type { Currency } from './format'
import type { LedgerRow, PaymentMethod, PaymentRow } from './types'

const PAGE = 1000 // Supabase returns at most 1000 rows per request

// Documents from the ledger view (voided ones are never exported)
export async function fetchLedger(
  opts: { from?: string; to?: string; onlyOpen?: boolean } = {}
): Promise<LedgerRow[]> {
  const out: LedgerRow[] = []
  for (let start = 0; ; start += PAGE) {
    let q = supabase.from('purchase_invoices_ledger').select('*').neq('status', 'VOID')
    if (opts.from) q = q.gte('invoice_date', opts.from)
    if (opts.to) q = q.lte('invoice_date', opts.to)
    if (opts.onlyOpen) q = q.gt('remaining_amount', 0)
    const { data, error } = await q
      .order('invoice_date')
      .order('created_at')
      .order('id')
      .range(start, start + PAGE - 1)
    if (error) throw new Error(error.message)
    const batch = (data ?? []) as LedgerRow[]
    out.push(...batch)
    if (batch.length < PAGE) break
  }
  return out
}

// All payments, grouped by invoice (only for the invoices we need)
export async function fetchPayments(invoiceIds: Set<string>): Promise<Map<string, PaymentRow[]>> {
  const map = new Map<string, PaymentRow[]>()
  for (let start = 0; ; start += PAGE) {
    const { data, error } = await supabase
      .from('invoice_payments')
      .select('*')
      .order('payment_date')
      .order('id')
      .range(start, start + PAGE - 1)
    if (error) throw new Error(error.message)
    const batch = (data ?? []) as PaymentRow[]
    for (const p of batch) {
      if (!invoiceIds.has(p.invoice_id)) continue
      const list = map.get(p.invoice_id)
      if (list) list.push(p)
      else map.set(p.invoice_id, [p])
    }
    if (batch.length < PAGE) break
  }
  return map
}

export interface JournalPayment {
  id: string
  payment_date: string
  amount_paid: number
  method: PaymentMethod
  reference_number: string | null
  currency: Currency
  invoice_number: string
  supplier_code: string
  supplier_name: string
}

interface RawJournal {
  id: string
  payment_date: string
  amount_paid: number
  method: PaymentMethod
  reference_number: string | null
  purchase_invoices: unknown
}

const one = <T>(v: T | T[] | null | undefined): T | null => (Array.isArray(v) ? (v[0] ?? null) : (v ?? null))

// Payments made between two dates, with the invoice and supplier they belong to
export async function fetchJournal(from?: string, to?: string): Promise<JournalPayment[]> {
  const out: JournalPayment[] = []
  for (let start = 0; ; start += PAGE) {
    let q = supabase
      .from('invoice_payments')
      .select(
        'id, payment_date, amount_paid, method, reference_number, ' +
          'purchase_invoices!inner(invoice_number, currency, suppliers!inner(supplier_code, name))'
      )
    if (from) q = q.gte('payment_date', from)
    if (to) q = q.lte('payment_date', to)
    const { data, error } = await q
      .order('payment_date')
      .order('id')
      .range(start, start + PAGE - 1)
    if (error) throw new Error(error.message)

    const batch = (data ?? []) as unknown as RawJournal[]
    for (const p of batch) {
      const inv = one(
        p.purchase_invoices as {
          invoice_number: string
          currency: Currency
          suppliers: unknown
        } | null
      )
      const sup = one(inv?.suppliers as { supplier_code: string; name: string } | null)
      if (!inv || !sup) continue
      out.push({
        id: p.id,
        payment_date: p.payment_date,
        amount_paid: p.amount_paid,
        method: p.method,
        reference_number: p.reference_number,
        currency: inv.currency,
        invoice_number: inv.invoice_number,
        supplier_code: sup.supplier_code,
        supplier_name: sup.name
      })
    }
    if (batch.length < PAGE) break
  }
  return out
}