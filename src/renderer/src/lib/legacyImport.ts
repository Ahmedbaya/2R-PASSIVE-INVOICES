import ExcelJS from 'exceljs'
import type { Currency } from './format'
import type { PaymentMethod } from './types'

// ---------- Types ----------
export type Level = 'error' | 'warning' | 'info'
export interface Issue {
  level: Level
  key: string // translation key, e.g. "imp_noDate"
  arg?: string
}
export type RowKind = 'ok' | 'warning' | 'error' | 'duplicate'

export interface ParsedPayment {
  date: string
  amount: number
  method: PaymentMethod
  reference: string | null
}

export interface ParsedRow {
  sheetRow: number
  supplierName: string
  supplierCode: string | null
  invoiceNumber: string
  invoiceDate: string | null
  dueDate: string | null
  currency: Currency | null
  amount: number | null
  payments: ParsedPayment[]
  issues: Issue[]
  kind: RowKind
  isNewSupplier: boolean
}

export interface ParseResult {
  sheetName: string
  rows: ParsedRow[]
  skipped: number
}

export interface DbSupplier {
  id: string
  supplier_code: string
  name: string
}

export interface DbInvoice {
  supplier_id: string
  invoice_number: string
  invoice_date: string
  currency: string
  invoice_amount: number
}

// ---------- The 16-column layout of PASSIVE ANGLAIS.xlsx (A to P) ----------
const COL = {
  code: 1, // A  SUPPLIER CODE 2R
  number: 2, // B  N FACT SUPPLIER
  date: 3, // C  DATE
  invTnd: 4, // D  invoice amount DT
  invEur: 5, // E  invoice amount EUR
  invUsd: 6, // F  invoice amount USD
  supplier: 7, // G  SUPPLIER
  due: 8, // H  WHEN TO PAY - DATE
  paidDate: 9, // I  WHEN YOU PAY DATE
  payTnd: 10, // J  amount paid DT
  payEur: 11, // K  amount paid EUR
  payUsd: 12, // L  amount paid USD
  method: 13, // M  PAYMENT TYPE
  remTnd: 14, // N  remaining DT
  remEur: 15, // O  remaining EUR
  remUsd: 16 // P  remaining USD
} as const

const CURS: Currency[] = ['TND', 'EUR', 'USD']
const DEC: Record<Currency, number> = { TND: 3, EUR: 2, USD: 2 }

const pad = (n: number, w = 2): string => String(n).padStart(w, '0')

// "M.I.P.M" and "m i p m" and "MÏPM" all compare equal
export const normName = (s: string): string =>
  s
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, ' ')
    .trim()

// ---------- Cell readers ----------
function cellRaw(cell: ExcelJS.Cell): unknown {
  let v: unknown = cell.value
  while (v && typeof v === 'object' && !(v instanceof Date)) {
    const o = v as Record<string, unknown>
    if ('result' in o) v = o.result // formula: use the stored result
    else if (Array.isArray(o.richText)) return (o.richText as { text: string }[]).map((r) => r.text).join('')
    else if (typeof o.text === 'string') return o.text
    else return null
  }
  return v ?? null
}

function toText(v: unknown): string {
  if (v === null || v === undefined || v instanceof Date) return ''
  return String(v).replace(/\s+/g, ' ').trim()
}

function validISO(y: number, m: number, d: number): string | null {
  const dt = new Date(Date.UTC(y, m - 1, d))
  if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== m - 1 || dt.getUTCDate() !== d) return null
  if (y < 2000 || y > 2100) return null
  return `${y}-${pad(m)}-${pad(d)}`
}

function toISODate(v: unknown): string | null {
  if (v instanceof Date) {
    if (isNaN(v.getTime())) return null
    return validISO(v.getUTCFullYear(), v.getUTCMonth() + 1, v.getUTCDate())
  }
  if (typeof v === 'number') {
    if (v < 20000 || v > 80000) return null
    const d = new Date(Math.round((v - 25569) * 86400000))
    return validISO(d.getUTCFullYear(), d.getUTCMonth() + 1, d.getUTCDate())
  }
  if (typeof v === 'string') {
    const s = v.trim()
    let m = s.match(/^(\d{1,2})[/\-.](\d{1,2})[/\-.](\d{2}|\d{4})$/)
    if (m) {
      const y = Number(m[3])
      return validISO(y < 100 ? 2000 + y : y, Number(m[2]), Number(m[1]))
    }
    m = s.match(/^(\d{4})-(\d{2})-(\d{2})/)
    if (m) return validISO(Number(m[1]), Number(m[2]), Number(m[3]))
  }
  return null
}

interface Amount {
  value: number
  bad: boolean // text that is not a number, for example "- €"
  fromText: boolean // text that could be read as a number, for example "1 201,000"
  text: string
}

function toAmount(v: unknown): Amount {
  if (v === null || v === undefined || v === '') return { value: 0, bad: false, fromText: false, text: '' }
  if (typeof v === 'number') {
    return { value: Number.isFinite(v) ? v : 0, bad: false, fromText: false, text: '' }
  }
  const text = toText(v) || String(v)
  if (text === '') return { value: 0, bad: false, fromText: false, text: '' }
  let s = text.replace(/[^\d.,-]/g, '')
  if (!/\d/.test(s)) return { value: 0, bad: true, fromText: false, text }
  // the last "," or "." is the decimal separator
  if (s.lastIndexOf(',') > s.lastIndexOf('.')) s = s.replace(/\./g, '').replace(',', '.')
  else s = s.replace(/,/g, '')
  const n = Number(s)
  return Number.isFinite(n)
    ? { value: n, bad: false, fromText: true, text }
    : { value: 0, bad: true, fromText: false, text }
}

const tooPrecise = (n: number, c: Currency): boolean => {
  const f = 10 ** DEC[c]
  return Math.abs(n * f - Math.round(n * f)) > 1e-6
}

// "CE CONFECTION FAC N'03/2026"  ->  { name: "CE CONFECTION", number: "03/2026" }
function splitSupplier(text: string): { name: string; number: string | null } {
  const m = text.match(/^(.*?)[\s,;\-–]*\bFACT?(?:URE)?\b\.?\s*(?:N\s*[°º'’`.:]*\s*)?(\d[\w\-/.]*)\s*$/i)
  if (m && m[1].trim() !== '') return { name: m[1].trim(), number: m[2] }
  return { name: text, number: null }
}

// "2R 001" -> "2R001". Anything else (like the "SUPPLIER CODE 2 R" placeholder) -> null
function parseCode(text: string): string | null {
  const m = text.toUpperCase().replace(/\s+/g, '').match(/^2R0*(\d+)$/)
  return m ? `2R${m[1].padStart(3, '0')}` : null
}

// "PAIEMENT PAR CHEQUE N'0000269" -> CHEQUE + "0000269"
function parseMethod(text: string): { method: PaymentMethod; reference: string | null; known: boolean } {
  const plain = text.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toUpperCase()
  let method: PaymentMethod = 'OTHER'
  let known = true
  if (/CHEQ|CHECK|ASSEGN/.test(plain)) method = 'CHEQUE'
  else if (/VIREM|TRANSF|BONIFIC|\bVIR\b|SWIFT/.test(plain)) method = 'VIREMENT'
  else if (/ESPEC|CASH|CONTANT/.test(plain)) method = 'ESPECE'
  else if (/TRAITE|TRATTA|EFFET/.test(plain)) method = 'TRAITE'
  else if (/CARTE|CARD|CARTA/.test(plain)) method = 'CARTE'
  else known = false

  const byLabel = text.match(/\b(?:N|NO|NUM|NUMERO)\b\s*[°º'’`.:]*\s*(\d[\d\-/]*)/i)
  const byDigits = text.match(/(\d{5,}[\d\-/]*)/)
  const reference = byLabel ? byLabel[1] : byDigits ? byDigits[1] : null
  return { method, reference, known }
}

function dedupe(issues: Issue[]): Issue[] {
  const seen = new Set<string>()
  return issues.filter((i) => {
    const k = `${i.level}|${i.key}|${i.arg ?? ''}`
    if (seen.has(k)) return false
    seen.add(k)
    return true
  })
}

function kindOf(issues: Issue[]): RowKind {
  if (issues.some((i) => i.level === 'error')) return 'error'
  if (issues.some((i) => i.level === 'warning')) return 'warning'
  return 'ok'
}

// ---------- 1. Read and check the workbook ----------
interface Draft {
  row: ParsedRow
  sheetNumber: string
  nameNumber: string | null
}

export async function parseWorkbook(file: File): Promise<ParseResult> {
  const wb = new ExcelJS.Workbook()
  await wb.xlsx.load((await file.arrayBuffer()) as unknown as ExcelJS.Buffer)
  const ws = wb.worksheets.find((w) => /fattur|passiv|factur/i.test(w.name)) ?? wb.worksheets[0]
  if (!ws) throw new Error('NO_SHEET')

  const drafts: Draft[] = []
  let skipped = 0
  let started = false // becomes true at the first real data row (everything above is title / header)

  for (let r = 1; r <= ws.rowCount; r++) {
    const xl = ws.getRow(r)
    if (!xl.hasValues) continue
    const get = (c: number): unknown => cellRaw(xl.getCell(c))

    const invoiceDate = toISODate(get(COL.date))
    const supplierText = toText(get(COL.supplier))

    if (!started) {
      if (invoiceDate && supplierText) started = true
      else {
        skipped++
        continue
      }
    }
    if (!invoiceDate && !supplierText) {
      skipped++ // totals row, notes...
      continue
    }

    const issues: Issue[] = []
    if (!invoiceDate) issues.push({ level: 'error', key: 'imp_noDate' })
    if (!supplierText) issues.push({ level: 'error', key: 'imp_noSupplier' })

    const inv = [COL.invTnd, COL.invEur, COL.invUsd].map((c) => toAmount(get(c)))
    const pay = [COL.payTnd, COL.payEur, COL.payUsd].map((c) => toAmount(get(c)))
    const remCols = [COL.remTnd, COL.remEur, COL.remUsd]

    for (const a of [...inv, ...pay]) {
      if (a.bad) issues.push({ level: 'warning', key: 'imp_badText', arg: a.text })
      else if (a.fromText) issues.push({ level: 'info', key: 'imp_textAmount', arg: a.text })
    }
    for (const c of remCols) {
      const a = toAmount(get(c))
      if (a.bad) issues.push({ level: 'warning', key: 'imp_textInRemaining', arg: a.text })
    }
    if ([...inv, ...pay].some((a) => a.value < 0)) issues.push({ level: 'error', key: 'imp_negative' })

    // Invoice currency = the one currency column that holds an amount
    const invIdx = inv.map((a, i) => (a.value > 0 ? i : -1)).filter((i) => i >= 0)
    let currency: Currency | null = null
    let amount: number | null = null
    if (invIdx.length === 0) issues.push({ level: 'error', key: 'imp_noAmount' })
    else if (invIdx.length > 1) issues.push({ level: 'error', key: 'imp_multiCurrency' })
    else {
      currency = CURS[invIdx[0]]
      amount = inv[invIdx[0]].value
      if (tooPrecise(amount, currency)) issues.push({ level: 'error', key: 'imp_precision' })
    }

    // Due date
    let dueDate = toISODate(get(COL.due))
    if (invoiceDate) {
      if (!dueDate) {
        issues.push({ level: 'warning', key: 'imp_dueMissing' })
        dueDate = invoiceDate
      } else if (dueDate < invoiceDate) {
        issues.push({ level: 'warning', key: 'imp_dueBefore' })
        dueDate = invoiceDate
      }
    }

    // Payment
    const payments: ParsedPayment[] = []
    const payIdx = pay.map((a, i) => (a.value > 0 ? i : -1)).filter((i) => i >= 0)
    const paidDate = toISODate(get(COL.paidDate))
    const methodText = toText(get(COL.method))

    if (payIdx.length > 1) {
      issues.push({ level: 'error', key: 'imp_payMulti' })
    } else if (payIdx.length === 1 && currency && amount !== null) {
      const paid = pay[payIdx[0]].value
      if (payIdx[0] !== invIdx[0]) issues.push({ level: 'error', key: 'imp_payCurrency' })
      else if (tooPrecise(paid, currency)) issues.push({ level: 'error', key: 'imp_precision' })
      else if (Math.round(paid * 1000) > Math.round(amount * 1000)) {
        issues.push({ level: 'error', key: 'imp_overpaid' })
      } else {
        let date = paidDate
        if (!date) {
          issues.push({ level: 'warning', key: 'imp_payDateMissing' })
          date = dueDate
        }
        const pm = parseMethod(methodText)
        if (methodText === '') issues.push({ level: 'warning', key: 'imp_methodMissing' })
        else if (!pm.known) issues.push({ level: 'warning', key: 'imp_methodUnknown', arg: methodText })
        if (date) payments.push({ date, amount: paid, method: pm.method, reference: pm.reference })

        // Compare with the remaining balance typed in Excel
        const remRaw = get(remCols[invIdx[0]])
        const expected = amount - paid
        if (typeof remRaw === 'number' && Math.abs(remRaw - expected) > 0.0005) {
          issues.push({ level: 'warning', key: 'imp_remainingMismatch', arg: String(remRaw) })
        }
      }
    } else if (payIdx.length === 0 && paidDate) {
      issues.push({ level: 'warning', key: 'imp_payDateNoAmount' })
    }

    const split = splitSupplier(supplierText)
    const clean = dedupe(issues)

    drafts.push({
      sheetNumber: toText(get(COL.number)),
      nameNumber: split.number,
      row: {
        sheetRow: r,
        supplierName: split.name,
        supplierCode: parseCode(toText(get(COL.code))),
        invoiceNumber: '',
        invoiceDate,
        dueDate,
        currency,
        amount,
        payments,
        issues: clean,
        kind: kindOf(clean),
        isNewSupplier: false
      }
    })
  }

  // Column B is a placeholder when the same value fills most of the rows (like "1" everywhere)
  const counts = new Map<string, number>()
  for (const d of drafts) {
    if (d.sheetNumber) counts.set(d.sheetNumber, (counts.get(d.sheetNumber) ?? 0) + 1)
  }
  const placeholders = new Set(
    [...counts.entries()].filter(([, n]) => n >= 2 && n > drafts.length / 2).map(([v]) => v)
  )

  const rows = drafts.map((d) => {
    const issues = [...d.row.issues]
    let number: string
    if (d.sheetNumber && !placeholders.has(d.sheetNumber)) {
      number = d.sheetNumber
    } else if (d.nameNumber) {
      number = d.nameNumber
      issues.push({ level: 'info', key: 'imp_numberFromName', arg: number })
    } else {
      number = `LEGACY-${pad(d.row.sheetRow, 3)}`
      issues.push({ level: 'warning', key: 'imp_numberGenerated', arg: number })
    }
    return { ...d.row, invoiceNumber: number, issues, kind: kindOf(issues) }
  })

  return { sheetName: ws.name, rows, skipped }
}

// ---------- 2. Compare with what is already in the database ----------
export function analyze(rows: ParsedRow[], suppliers: DbSupplier[], invoices: DbInvoice[]): ParsedRow[] {
  const supplierByName = new Map(suppliers.map((s) => [normName(s.name), s]))
  const bySupplier = new Map<string, DbInvoice[]>()
  for (const i of invoices) {
    const list = bySupplier.get(i.supplier_id)
    if (list) list.push(i)
    else bySupplier.set(i.supplier_id, [i])
  }

  const seen = new Set<string>()
  return rows.map((row) => {
    const issues = [...row.issues]
    const key = normName(row.supplierName)
    const supplier = supplierByName.get(key)
    let kind = row.kind

    if (kind !== 'error') {
      const dupKey = `${key}|${row.invoiceNumber.toUpperCase()}`
      if (seen.has(dupKey)) {
        issues.push({ level: 'warning', key: 'imp_dupInFile' })
        kind = 'duplicate'
      } else if (supplier) {
        const hit = (bySupplier.get(supplier.id) ?? []).find(
          (i) =>
            i.invoice_number.toUpperCase() === row.invoiceNumber.toUpperCase() ||
            (i.invoice_date === row.invoiceDate &&
              i.currency === row.currency &&
              Math.abs(Number(i.invoice_amount) - (row.amount ?? 0)) < 0.0005)
        )
        if (hit) {
          issues.push({ level: 'warning', key: 'imp_dupExisting', arg: hit.invoice_number })
          kind = 'duplicate'
        }
      }
      seen.add(dupKey)
    }
    return { ...row, issues, kind, isNewSupplier: !supplier }
  })
}

// ---------- 3. Build the data sent to the database function ----------
export function buildPayload(
  rows: ParsedRow[],
  suppliers: DbSupplier[]
): {
  suppliers: { code: string; name: string; currency: Currency }[]
  invoices: unknown[]
} {
  const usedCodes = new Set(suppliers.map((s) => s.supplier_code))
  const codeByName = new Map(suppliers.map((s) => [normName(s.name), s.supplier_code]))
  let maxN = 0
  for (const c of usedCodes) {
    const m = c.match(/^2R(\d+)$/)
    if (m) maxN = Math.max(maxN, Number(m[1]))
  }

  const newSuppliers: { code: string; name: string; currency: Currency }[] = []
  const invoices = rows.map((r) => {
    const key = normName(r.supplierName)
    let code = codeByName.get(key)
    if (!code) {
      if (r.supplierCode && !usedCodes.has(r.supplierCode)) {
        code = r.supplierCode
      } else {
        do {
          maxN++
          code = `2R${pad(maxN, 3)}`
        } while (usedCodes.has(code))
      }
      usedCodes.add(code)
      codeByName.set(key, code)
      newSuppliers.push({ code, name: r.supplierName, currency: r.currency as Currency })
    }
    return {
      supplier_code: code,
      invoice_number: r.invoiceNumber,
      doc_type: 'INVOICE',
      invoice_date: r.invoiceDate,
      due_date: r.dueDate,
      currency: r.currency,
      amount: r.amount,
      notes: `Imported from Excel (row ${r.sheetRow})`,
      payments: r.payments.map((p) => ({
        date: p.date,
        amount: p.amount,
        method: p.method,
        reference: p.reference,
        notes: 'Imported from Excel'
      }))
    }
  })

  return { suppliers: newSuppliers, invoices }
}