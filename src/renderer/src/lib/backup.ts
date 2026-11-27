import ExcelJS from 'exceljs'
import { supabase } from './supabase'

const PAGE = 1000
type Row = Record<string, unknown>

async function fetchTable(table: string): Promise<Row[]> {
  const out: Row[] = []
  for (let start = 0; ; start += PAGE) {
    const { data, error } = await supabase
      .from(table)
      .select('*')
      .order('id')
      .range(start, start + PAGE - 1)
    if (error) throw new Error(`${table}: ${error.message}`)
    const batch = (data ?? []) as Row[]
    out.push(...batch)
    if (batch.length < PAGE) break
  }
  return out
}

export interface BackupData {
  app: string
  version: number
  exportedAt: string
  suppliers: Row[]
  supplier_items: Row[]
  purchase_invoices: Row[]
  invoice_payments: Row[]
}

export async function fetchBackup(): Promise<BackupData> {
  const [suppliers, supplier_items, purchase_invoices, invoice_payments] = await Promise.all([
    fetchTable('suppliers'),
    fetchTable('supplier_items'),
    fetchTable('purchase_invoices'),
    fetchTable('invoice_payments')
  ])
  return {
    app: 'factures-passives-manager',
    version: 2,
    exportedAt: new Date().toISOString(),
    suppliers,
    supplier_items,
    purchase_invoices,
    invoice_payments
  }
}

export function backupToJson(backup: BackupData): Uint8Array {
  return new TextEncoder().encode(JSON.stringify(backup, null, 2))
}

export async function backupToXlsx(backup: BackupData): Promise<Uint8Array> {
  const wb = new ExcelJS.Workbook()
  wb.creator = 'Factures Passives Manager'

  const tables: [string, Row[]][] = [
    ['suppliers', backup.suppliers],
    ['supplier_items', backup.supplier_items],
    ['purchase_invoices', backup.purchase_invoices],
    ['invoice_payments', backup.invoice_payments]
  ]

  for (const [name, rows] of tables) {
    const ws = wb.addWorksheet(name, { views: [{ state: 'frozen', ySplit: 1 }] })
    const cols = rows.length > 0 ? Object.keys(rows[0]) : ['id']
    ws.columns = cols.map((c) => ({ header: c, key: c, width: Math.min(40, Math.max(14, c.length + 2)) }))
    for (const r of rows) {
      ws.addRow(cols.map((c) => (r[c] === undefined ? null : (r[c] as ExcelJS.CellValue))))
    }
    ws.getRow(1).font = { bold: true }
    ws.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: cols.length } }
  }

  const buffer = await wb.xlsx.writeBuffer()
  return new Uint8Array(buffer as unknown as ArrayBuffer)
}