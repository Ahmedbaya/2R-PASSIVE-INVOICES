import type { Dictionary } from '../i18n/translations'
import { CURRENCIES, formatDate, formatMoney, todayISO, type Currency } from './format'
import type { LedgerRow, PaymentMethod } from './types'
import type { JournalPayment } from './reportData'
import { LOGO } from '../assets/logo'

type T = (key: keyof Dictionary) => string

const esc = (s: unknown): string =>
  String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')

const fill = (text: string, ...args: (string | number)[]): string =>
  args.reduce<string>((acc, a, i) => acc.replace(`{${i}}`, String(a)), text)

const utcDay = (iso: string): number =>
  Date.UTC(Number(iso.slice(0, 4)), Number(iso.slice(5, 7)) - 1, Number(iso.slice(8, 10)))
const daysBetween = (aIso: string, bIso: string): number =>
  Math.round((utcDay(aIso) - utcDay(bIso)) / 86400000)

const CSS = `
  body { font-family: 'Segoe UI', Arial, sans-serif; font-size: 10px; color: #111; margin: 0; }
  .company { font-size: 12px; font-weight: bold; color: #334155; }
  h1 { font-size: 18px; margin: 2px 0; }
  .sub { color: #555; margin-bottom: 10px; }
  h2 { font-size: 13px; margin: 18px 0 6px; padding: 4px 8px; background: #1e293b; color: #fff; }
  table { width: 100%; border-collapse: collapse; margin-bottom: 8px; }
  thead { display: table-header-group; }
  tr { page-break-inside: avoid; }
  th { background: #e2e8f0; text-align: left; padding: 4px 6px; font-size: 9px; text-transform: uppercase; }
  td { padding: 3px 6px; border-bottom: 1px solid #e5e7eb; vertical-align: top; }
  .r { text-align: right; white-space: nowrap; }
  .nw { white-space: nowrap; }
  .code { color: #64748b; font-family: Consolas, monospace; font-size: 9px; }
  .red { color: #b91c1c; font-weight: bold; }
  .tot td { font-weight: bold; border-top: 2px solid #334155; background: #f1f5f9; }
  .buckets th, .buckets td { text-align: right; }
  .note { color: #64748b; font-size: 9px; margin-top: 12px; }
`

function page(title: string, lang: string, body: string): string {
  return (
    `<!doctype html><html lang="${esc(lang)}"><head><meta charset="utf-8">` +
    `<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; img-src data:">` +
    `<title>${esc(title)}</title><style>${CSS}</style></head><body>${body}</body></html>`
  )
}

function header(company: string, title: string, subtitle: string): string {
  const info = company
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean)
    .map((line, i) =>
      i === 0
        ? `<div class="company">${esc(line)}</div>`
        : `<div style="color:#64748b;font-size:9px;">${esc(line)}</div>`
    )
    .join('')
  return (
    `<table style="width:100%;border:0;margin:0 0 4px;"><tr>` +
    `<td style="border:0;padding:0;width:70px;vertical-align:middle;">` +
    `<img src="${LOGO}" style="width:60px;height:60px;" alt=""></td>` +
    `<td style="border:0;padding:0;vertical-align:middle;">${info}</td></tr></table>` +
    `<h1 style="margin-top:6px;">${esc(title)}</h1><div class="sub">${esc(subtitle)}</div>`
  )
}

// =====================================================================
//  Unpaid Payables Aging Report
// =====================================================================
export function agingReportHtml(args: {
  rows: LedgerRow[]
  company: string
  t: T
  locale: string
  lang: string
}): string {
  const { rows, company, t, locale, lang } = args
  const asOf = todayISO()

  const sections = CURRENCIES.map((c) => {
    const list = rows
      .filter((r) => r.currency === c && Number(r.remaining_amount) > 0)
      .sort(
        (a, b) =>
          a.due_date.localeCompare(b.due_date) || a.supplier_name.localeCompare(b.supplier_name)
      )
    if (list.length === 0) return ''

    const buckets = [0, 0, 0, 0, 0]
    let invoiced = 0
    let paid = 0
    let remaining = 0

    const body = list
      .map((r) => {
        const late = daysBetween(asOf, r.due_date) // positive = days overdue
        const rem = Number(r.remaining_amount)
        buckets[late <= 0 ? 0 : late <= 30 ? 1 : late <= 60 ? 2 : late <= 90 ? 3 : 4] += rem
        invoiced += Number(r.invoice_amount)
        paid += Number(r.total_paid)
        remaining += rem
        const timing =
          late > 0 ? fill(t('daysLate'), late) : late === 0 ? t('dueToday') : fill(t('dueInDays'), -late)
        return (
          `<tr><td class="nw">${formatDate(r.due_date)}</td>` +
          `<td><b>${esc(r.supplier_name)}</b><br><span class="code">${esc(r.supplier_code)}</span></td>` +
          `<td>${esc(r.invoice_number)}</td>` +
          `<td>${esc(t(`type_${r.doc_type}` as keyof Dictionary))}</td>` +
          `<td class="nw">${formatDate(r.invoice_date)}</td>` +
          `<td class="r">${formatMoney(r.invoice_amount, c, locale)}</td>` +
          `<td class="r">${formatMoney(r.total_paid, c, locale)}</td>` +
          `<td class="r red">${formatMoney(rem, c, locale)}</td>` +
          `<td class="${late > 0 ? 'red' : ''}">${esc(timing)}</td></tr>`
        )
      })
      .join('')

    const bucketLabels: (keyof Dictionary)[] = ['ageNotDue', 'age1_30', 'age31_60', 'age61_90', 'age90plus']

    return (
      `<h2>${c}</h2>` +
      `<table class="buckets"><thead><tr>${bucketLabels.map((k) => `<th>${esc(t(k))}</th>`).join('')}` +
      `<th>${esc(t('ageTotal'))}</th></tr></thead><tbody><tr>` +
      buckets.map((v, i) => `<td class="${i > 0 && v > 0 ? 'red' : ''}">${formatMoney(v, c, locale)}</td>`).join('') +
      `<td><b>${formatMoney(remaining, c, locale)}</b></td></tr></tbody></table>` +
      `<table><thead><tr><th>${esc(t('colDueDate'))}</th><th>${esc(t('colSupplier'))}</th>` +
      `<th>${esc(t('colNumber'))}</th><th>${esc(t('colType'))}</th><th>${esc(t('colInvoiceDate'))}</th>` +
      `<th class="r">${esc(t('colAmount'))}</th><th class="r">${esc(t('colPaid'))}</th>` +
      `<th class="r">${esc(t('colRemaining'))}</th><th>${esc(t('colDays'))}</th></tr></thead>` +
      `<tbody>${body}<tr class="tot"><td colspan="5">${esc(t('subtotal'))} ${c} (${list.length})</td>` +
      `<td class="r">${formatMoney(invoiced, c, locale)}</td><td class="r">${formatMoney(paid, c, locale)}</td>` +
      `<td class="r red">${formatMoney(remaining, c, locale)}</td><td></td></tr></tbody></table>`
    )
  }).join('')

  const subtitle = `${t('agingAsOf')} ${formatDate(asOf)} · ${t('generatedOn')} ${formatDate(asOf)}`
  const content = sections || `<p>${esc(t('noOpenDocs'))}</p>`
  return page(
    t('agingTitle'),
    lang,
    header(company, t('agingTitle'), subtitle) + content + `<p class="note">${esc(t('currenciesNotAdded'))}</p>`
  )
}

// =====================================================================
//  Monthly Payment Journal
// =====================================================================
const METHOD_ORDER: PaymentMethod[] = ['CHEQUE', 'VIREMENT', 'ESPECE', 'TRAITE', 'CARTE', 'OTHER']

export function journalHtml(args: {
  payments: JournalPayment[]
  from: string
  to: string
  company: string
  t: T
  locale: string
  lang: string
}): string {
  const { payments, from, to, company, t, locale, lang } = args

  const periodText =
    from || to
      ? `${from ? formatDate(from) : '…'} – ${to ? formatDate(to) : '…'}`
      : t('allDates')
  const subtitle = `${t('period')}: ${periodText} · ${t('generatedOn')} ${formatDate(todayISO())}`

  const totals = new Map<PaymentMethod, Record<Currency, number>>()
  const grand: Record<Currency, number> = { TND: 0, EUR: 0, USD: 0 }

  const sections = METHOD_ORDER.map((m) => {
    const list = payments
      .filter((p) => p.method === m)
      .sort((a, b) => {
        const ra = a.reference_number ?? ''
        const rb = b.reference_number ?? ''
        if (!!ra !== !!rb) return ra ? -1 : 1 // payments without a reference go last
        return (
          ra.localeCompare(rb, undefined, { numeric: true }) ||
          a.payment_date.localeCompare(b.payment_date)
        )
      })
    if (list.length === 0) return ''

    const sub: Record<Currency, number> = { TND: 0, EUR: 0, USD: 0 }
    const body = list
      .map((p) => {
        sub[p.currency] += Number(p.amount_paid)
        return (
          `<tr><td class="nw"><b>${esc(p.reference_number ?? '—')}</b></td>` +
          `<td class="nw">${formatDate(p.payment_date)}</td>` +
          `<td><b>${esc(p.supplier_name)}</b><br><span class="code">${esc(p.supplier_code)}</span></td>` +
          `<td>${esc(p.invoice_number)}</td>` +
          `<td class="r">${formatMoney(p.amount_paid, p.currency, locale)}</td></tr>`
        )
      })
      .join('')

    totals.set(m, sub)
    for (const c of CURRENCIES) grand[c] += sub[c]

    const subRows = CURRENCIES.filter((c) => sub[c] > 0)
      .map(
        (c) =>
          `<tr class="tot"><td colspan="4">${esc(t('subtotal'))} ${c}</td>` +
          `<td class="r">${formatMoney(sub[c], c, locale)}</td></tr>`
      )
      .join('')

    return (
      `<h2>${esc(t(`method_${m}` as keyof Dictionary))} (${list.length})</h2>` +
      `<table><thead><tr><th>${esc(t('colReference'))}</th><th>${esc(t('paymentDate'))}</th>` +
      `<th>${esc(t('colSupplier'))}</th><th>${esc(t('colNumber'))}</th>` +
      `<th class="r">${esc(t('colAmount'))}</th></tr></thead><tbody>${body}${subRows}</tbody></table>`
    )
  }).join('')

  const summaryRows = METHOD_ORDER.filter((m) => totals.has(m))
    .map((m) => {
      const s = totals.get(m)!
      return (
        `<tr><td>${esc(t(`method_${m}` as keyof Dictionary))}</td>` +
        CURRENCIES.map((c) => `<td class="r">${s[c] > 0 ? formatMoney(s[c], c, locale) : '—'}</td>`).join('') +
        `</tr>`
      )
    })
    .join('')

  const summary =
    totals.size === 0
      ? ''
      : `<h2>${esc(t('summaryByMethod'))}</h2><table><thead><tr><th>${esc(t('colMethod'))}</th>` +
        CURRENCIES.map((c) => `<th class="r">${c}</th>`).join('') +
        `</tr></thead><tbody>${summaryRows}<tr class="tot"><td>${esc(t('grandTotal'))}</td>` +
        CURRENCIES.map((c) => `<td class="r">${grand[c] > 0 ? formatMoney(grand[c], c, locale) : '—'}</td>`).join('') +
        `</tr></tbody></table>`

  return page(
    t('journalTitle'),
    lang,
    header(company, t('journalTitle'), subtitle) + sections + summary + `<p class="note">${esc(t('currenciesNotAdded'))}</p>`
  )
}