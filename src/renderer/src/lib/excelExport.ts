import ExcelJS from 'exceljs'
import { formatDate } from './format'
import type { Lang } from '../i18n/translations'
import type { LedgerRow, PaymentMethod, PaymentRow } from './types'

// Texts of the workbook in each export language. English = your original PASSIVE ANGLAIS.xlsx.
// The 16 columns (A to P) always stay in the same place, whatever the language.
interface XlText {
  sheet: string
  title: string
  note: string
  total: string
  allDates: string
  periodLabel: string
  exportedOn: string
  headers: string[]
  methods: Record<PaymentMethod, string>
}

const XL: Record<Lang, XlText> = {
  en: {
    sheet: 'FATTURE PASSIVE',
    title: 'PURCHASE INVOICES',
    note: 'IF UNPAID, NUMBER IN RED',
    total: 'TOTAL',
    allDates: 'all dates',
    periodLabel: 'Invoice dates',
    exportedOn: 'exported on',
    headers: [
      'SUPPLIER CODE 2 R',
      'N FACT SUPPLIER',
      'DATE',
      'INVOICE AMOUNT (DT)',
      'INVOICE AMOUNT (EUR)',
      'INVOICE AMOUNT (DOLLAR)',
      'SUPPLIER',
      'WHEN TO PAY – DATE',
      'WHEN YOU PAY DATE',
      'AMOUNT TO BE PAID IN DINARS',
      'AMOUNT TO BE PAID IN EUROS',
      'AMOUNT TO BE PAID IN DOLLARS',
      'PAYMENT TYPE',
      'DINARS TO BE PAID',
      'EUROS TO BE PAID',
      'DOLLARS TO BE PAID'
    ],
    methods: {
      CHEQUE: 'PAYMENT BY CHEQUE',
      VIREMENT: 'PAYMENT BY TRANSFER',
      ESPECE: 'PAYMENT BY CASH',
      TRAITE: 'PAYMENT BY BILL OF EXCHANGE (TRAITE)',
      CARTE: 'PAYMENT BY CARD',
      OTHER: 'PAYMENT'
    }
  },
  fr: {
    sheet: 'FACTURES PASSIVES',
    title: 'FACTURES PASSIVES',
    note: 'SI IMPAYÉ, MONTANT EN ROUGE',
    total: 'TOTAL',
    allDates: 'toutes les dates',
    periodLabel: 'Dates de facture',
    exportedOn: 'exporté le',
    headers: [
      'CODE FOURNISSEUR 2R',
      'N° FACTURE FOURNISSEUR',
      'DATE',
      'MONTANT FACTURE (DT)',
      'MONTANT FACTURE (EUR)',
      'MONTANT FACTURE (DOLLAR)',
      'FOURNISSEUR',
      "DATE D'ÉCHÉANCE",
      'DATE DE PAIEMENT',
      'MONTANT PAYÉ EN DINARS',
      'MONTANT PAYÉ EN EUROS',
      'MONTANT PAYÉ EN DOLLARS',
      'MODE DE PAIEMENT',
      'RESTE À PAYER EN DINARS',
      'RESTE À PAYER EN EUROS',
      'RESTE À PAYER EN DOLLARS'
    ],
    methods: {
      CHEQUE: 'PAIEMENT PAR CHEQUE',
      VIREMENT: 'PAIEMENT PAR VIREMENT',
      ESPECE: 'PAIEMENT PAR ESPECE',
      TRAITE: 'PAIEMENT PAR TRAITE',
      CARTE: 'PAIEMENT PAR CARTE',
      OTHER: 'PAIEMENT'
    }
  },
  it: {
    sheet: 'FATTURE PASSIVE',
    title: 'FATTURE PASSIVE',
    note: 'SE NON PAGATO, IMPORTO IN ROSSO',
    total: 'TOTALE',
    allDates: 'tutte le date',
    periodLabel: 'Date fattura',
    exportedOn: 'esportato il',
    headers: [
      'CODICE FORNITORE 2R',
      'N. FATTURA FORNITORE',
      'DATA',
      'IMPORTO FATTURA (DT)',
      'IMPORTO FATTURA (EUR)',
      'IMPORTO FATTURA (DOLLARI)',
      'FORNITORE',
      'DATA DI SCADENZA',
      'DATA DI PAGAMENTO',
      'IMPORTO PAGATO IN DINARI',
      'IMPORTO PAGATO IN EURO',
      'IMPORTO PAGATO IN DOLLARI',
      'METODO DI PAGAMENTO',
      'RESIDUO DA PAGARE IN DINARI',
      'RESIDUO DA PAGARE IN EURO',
      'RESIDUO DA PAGARE IN DOLLARI'
    ],
    methods: {
      CHEQUE: 'PAGAMENTO CON ASSEGNO',
      VIREMENT: 'PAGAMENTO CON BONIFICO',
      ESPECE: 'PAGAMENTO IN CONTANTI',
      TRAITE: 'PAGAMENTO CON TRATTA',
      CARTE: 'PAGAMENTO CON CARTA',
      OTHER: 'PAGAMENTO'
    }
  }
}

const WIDTHS = [16, 16, 12, 16, 16, 16, 30, 14, 16, 16, 16, 16, 38, 16, 16, 16]

// Zero shows as "-", negatives in red
const FMT = {
  TND: '#,##0.000" DT";[Red]-#,##0.000" DT";"-"',
  EUR: '#,##0.00" €";[Red]-#,##0.00" €";"-"',
  USD: '#,##0.00" $";[Red]-#,##0.00" $";"-"'
} as const
type Cur = keyof typeof FMT

const AMOUNT_COLS = [4, 5, 6, 10, 11, 12, 14, 15, 16]
const curOfCol = (col: number): Cur =>
  [4, 10, 14].includes(col) ? 'TND' : [5, 11, 15].includes(col) ? 'EUR' : 'USD'

const colLetter = (n: number): string => String.fromCharCode(64 + n)
const round3 = (n: number): number => Math.round(n * 1000) / 1000

const utcDate = (iso: string): Date =>
  new Date(Date.UTC(Number(iso.slice(0, 4)), Number(iso.slice(5, 7)) - 1, Number(iso.slice(8, 10))))

const BLUE: ExcelJS.Fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFDBE5F1' } }
const GREY_LINE = { style: 'thin' as const, color: { argb: 'FFBFBFBF' } }
const BORDER: Partial<ExcelJS.Borders> = {
  top: GREY_LINE,
  left: GREY_LINE,
  bottom: GREY_LINE,
  right: GREY_LINE
}

export async function buildLegacyWorkbook(
  rows: LedgerRow[],
  payments: Map<string, PaymentRow[]>,
  period: { from: string; to: string },
  lang: Lang
): Promise<Uint8Array> {
  if (rows.length === 0) throw new Error('EMPTY')
  const X = XL[lang]

  // "PAIEMENT PAR CHEQUE N'0000269" (the N' reference format is the same in every language)
  const paymentText = (p: PaymentRow): string =>
    p.reference_number ? `${X.methods[p.method]} N'${p.reference_number}` : X.methods[p.method]

  const wb = new ExcelJS.Workbook()
  wb.creator = 'Factures Passives Manager'
  const ws = wb.addWorksheet(X.sheet, { views: [{ state: 'frozen', ySplit: 3 }] })
  ws.columns = WIDTHS.map((width) => ({ width }))

  // ----- Title area (rows 1 and 2) -----
  const periodText =
    period.from || period.to
      ? `${period.from ? formatDate(period.from) : '…'} – ${period.to ? formatDate(period.to) : '…'}`
      : X.allDates
  ws.getCell('A1').value = `${X.periodLabel}: ${periodText} · ${X.exportedOn} ${formatDate(new Date().toISOString())}`
  ws.getCell('A1').font = { italic: true, size: 9, color: { argb: 'FF808080' } }
  ws.getCell('B2').value = X.title
  ws.getCell('B2').font = { bold: true, size: 14 }
  ws.getCell('N2').value = X.note
  ws.getCell('N2').font = { color: { argb: 'FFFF0000' } }

  // ----- Header row (row 3) -----
  X.headers.forEach((text, i) => {
    const col = i + 1
    const cell = ws.getCell(3, col)
    cell.value = text
    cell.font = { bold: true, color: { argb: col >= 14 ? 'FFCC0000' : 'FF000000' } }
    cell.alignment = { horizontal: 'center', vertical: 'middle', wrapText: true }
    if (AMOUNT_COLS.includes(col)) cell.fill = BLUE
    cell.border = BORDER
  })
  ws.getRow(3).height = 45

  // ----- Data rows (from row 4) -----
  const first = 4
  const sums: Record<number, number> = {}
  for (const c of AMOUNT_COLS) sums[c] = 0

  rows.forEach((r, idx) => {
    const n = first + idx
    const amount = Number(r.invoice_amount)
    const paid = Number(r.total_paid)
    const colInv = r.currency === 'TND' ? 4 : r.currency === 'EUR' ? 5 : 6
    const colPaid = colInv + 6 // D -> J, E -> K, F -> L
    const pays = payments.get(r.id) ?? []

    const put = (col: number, value: ExcelJS.CellValue, align: 'left' | 'center' | 'right'): ExcelJS.Cell => {
      const cell = ws.getCell(n, col)
      cell.value = value
      cell.font = { bold: true }
      cell.alignment = { horizontal: align, vertical: 'middle', wrapText: true }
      cell.border = BORDER
      return cell
    }

    put(1, r.supplier_code, 'center')
    put(2, r.invoice_number, 'center')
    put(3, utcDate(r.invoice_date), 'center').numFmt = 'dd/mm/yyyy'
    put(7, r.supplier_name, 'left')
    put(8, utcDate(r.due_date), 'center').numFmt = 'dd/mm/yyyy'
    put(9, r.last_payment_date ? utcDate(r.last_payment_date) : null, 'center').numFmt = 'dd/mm/yyyy'
    put(13, pays.map(paymentText).join(' + '), 'center')

    // Empty amount cells keep the same look as the rest of the row
    for (const col of AMOUNT_COLS) {
      const cell = ws.getCell(n, col)
      cell.numFmt = FMT[curOfCol(col)]
      cell.fill = BLUE
      cell.border = BORDER
      cell.alignment = { horizontal: 'right', vertical: 'middle' }
    }

    // Invoice amount and amount paid go in the column of the invoice's currency
    ws.getCell(n, colInv).value = amount
    ws.getCell(n, colInv).font = { bold: true }
    sums[colInv] += amount
    if (paid > 0) {
      ws.getCell(n, colPaid).value = paid
      ws.getCell(n, colPaid).font = { bold: true }
      sums[colPaid] += paid
    }

    // Remaining balance: a LIVE formula in each of the three "to be paid" columns
    for (let i = 0; i < 3; i++) {
      const colRem = 14 + i
      const result = colInv === 4 + i ? round3(amount - paid) : 0
      const cell = ws.getCell(n, colRem)
      cell.value = {
        formula: `ROUND(${colLetter(4 + i)}${n}-${colLetter(10 + i)}${n},3)`,
        result
      }
      cell.font = { color: { argb: 'FFCC0000' } }
      sums[colRem] += result
    }
  })

  // ----- Totals row: one SUM per currency column -----
  const last = first + rows.length - 1
  const totalRow = last + 1
  const label = ws.getCell(totalRow, 7)
  label.value = X.total
  label.font = { bold: true }
  label.alignment = { horizontal: 'right' }
  for (const col of AMOUNT_COLS) {
    const cell = ws.getCell(totalRow, col)
    cell.value = {
      formula: `SUM(${colLetter(col)}${first}:${colLetter(col)}${last})`,
      result: round3(sums[col])
    }
    cell.numFmt = FMT[curOfCol(col)]
    cell.font = { bold: true, color: { argb: col >= 14 ? 'FFCC0000' : 'FF000000' } }
    cell.alignment = { horizontal: 'right' }
  }
  for (let col = 1; col <= 16; col++) {
    const cell = ws.getCell(totalRow, col)
    cell.border = { top: { style: 'medium' }, bottom: { style: 'medium' } }
    if (!AMOUNT_COLS.includes(col)) {
      cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF2F2F2' } }
    }
  }

  // ----- Conditional formatting: any remaining balance above 0 turns bold red -----
  ws.addConditionalFormatting({
    ref: `N${first}:P${last}`,
    rules: [
      {
        type: 'cellIs',
        operator: 'greaterThan',
        formulae: [0],
        priority: 1,
        style: { font: { bold: true, color: { argb: 'FFFF0000' } } }
      }
    ]
  })

  ws.autoFilter = { from: 'A3', to: `P${last}` }
  ws.pageSetup = { orientation: 'landscape', fitToPage: true, fitToWidth: 1, fitToHeight: 0 }

  const buffer = await wb.xlsx.writeBuffer()
  return new Uint8Array(buffer as unknown as ArrayBuffer)
}