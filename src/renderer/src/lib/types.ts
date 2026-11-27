import type { Currency } from './format'

export interface SupplierRow {
  id: string
  supplier_code: string
  name: string
  default_currency: Currency
  contact_name: string | null
  phone: string | null
  email: string | null
  address: string | null
  tax_id: string | null
  notes: string | null
  activity: string | null
  is_active: boolean
  invoice_count: number
  item_count: number
  open_tnd: number
  open_eur: number
  open_usd: number
}

export interface SupplierOption {
  id: string
  supplier_code: string
  name: string
  default_currency: Currency
  is_active: boolean
}

// One item purchased from a supplier
export interface SupplierItem {
  id: string
  supplier_id: string
  name: string
  reference: string | null
  unit: string | null
  unit_price: number | null
  currency: Currency
  notes: string | null
}

export type InvoiceStatus = 'UNPAID' | 'OVERDUE' | 'PARTIAL' | 'PARTIAL_OVERDUE' | 'PAID' | 'VOID'

export type DocType = 'INVOICE' | 'RECEIPT' | 'PAYMENT_SLIP' | 'OTHER_COST'
export const DOC_TYPES: DocType[] = ['INVOICE', 'RECEIPT', 'PAYMENT_SLIP', 'OTHER_COST']

// One row of the purchase_invoices_ledger view
export interface LedgerRow {
  id: string
  supplier_id: string
  supplier_code: string
  supplier_name: string
  invoice_number: string
  doc_type: DocType
  invoice_date: string
  due_date: string
  currency: Currency
  invoice_amount: number
  total_paid: number
  remaining_amount: number
  last_payment_date: string | null
  payment_count: number
  payment_summary: string | null
  payment_references: string | null
  attachment_path: string | null
  notes: string | null
  is_void: boolean
  status: InvoiceStatus
}

export type PaymentMethod = 'CHEQUE' | 'VIREMENT' | 'ESPECE' | 'TRAITE' | 'CARTE' | 'OTHER'
export const PAYMENT_METHODS: PaymentMethod[] = [
  'CHEQUE',
  'VIREMENT',
  'ESPECE',
  'TRAITE',
  'CARTE',
  'OTHER'
]

// One row of the invoice_payments table
export interface PaymentRow {
  id: string
  invoice_id: string
  payment_date: string
  amount_paid: number
  method: PaymentMethod
  reference_number: string | null
  notes: string | null
}