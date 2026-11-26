export type Currency = 'TND' | 'EUR' | 'USD'

export const CURRENCIES: Currency[] = ['TND', 'EUR', 'USD']

// TND = 3 decimals (millimes), EUR / USD = 2 decimals
const DECIMALS: Record<Currency, number> = { TND: 3, EUR: 2, USD: 2 }
const SYMBOL: Record<Currency, string> = { TND: 'DT', EUR: '€', USD: '$' }

// The number style follows the language:
//   en-US: 1,201.000 DT   fr-FR: 1 201,000 DT   it-IT: 1.201,000 DT
export function formatMoney(value: number | string, currency: Currency, locale: string): string {
  const d = DECIMALS[currency]
  // useGrouping 'always' makes Italian show 1.201,00 instead of 1201,00
  const options = {
    minimumFractionDigits: d,
    maximumFractionDigits: d,
    useGrouping: 'always'
  } as unknown as Intl.NumberFormatOptions
  return `${new Intl.NumberFormat(locale, options).format(Number(value))} ${SYMBOL[currency]}`
}

// Always dd/mm/yyyy, in every language
export function formatDate(iso: string | null | undefined): string {
  if (!iso) return ''
  const [y, m, d] = iso.slice(0, 10).split('-')
  return `${d}/${m}/${y}`
}

// Today's date as yyyy-mm-dd (the format <input type="date"> and the database use)
export function todayISO(): string {
  const d = new Date()
  const p = (n: number): string => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`
}

// Accepts "1250,5" or "1250.5". TND allows 3 decimals, EUR / USD allow 2.
// Returns null when the text is not a valid positive amount.
export function parseAmount(text: string, currency: Currency): number | null {
  const s = text.trim().replace(/\s/g, '').replace(',', '.')
  const re = new RegExp(`^\\d{1,9}(\\.\\d{1,${DECIMALS[currency]}})?$`)
  if (!re.test(s)) return null
  const n = Number(s)
  return n > 0 ? n : null
}