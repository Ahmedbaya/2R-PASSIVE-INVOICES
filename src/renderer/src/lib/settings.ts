import { supabase } from './supabase'
import type { Lang } from '../i18n/translations'

export interface Company {
  name: string
  address: string
  phone: string
  email: string
  taxId: string
}

export const EMPTY_COMPANY: Company = { name: '', address: '', phone: '', email: '', taxId: '' }

const str = (v: unknown): string => (typeof v === 'string' ? v : '')

// Company details are stored in the database, so every PC prints the same header
export async function fetchCompany(): Promise<Company> {
  const { data, error } = await supabase
    .from('app_settings')
    .select('value')
    .eq('key', 'company')
    .maybeSingle()
  if (error) throw new Error(error.message)
  const v = ((data as { value?: unknown } | null)?.value ?? {}) as Record<string, unknown>
  return {
    name: str(v.name),
    address: str(v.address),
    phone: str(v.phone),
    email: str(v.email),
    taxId: str(v.taxId)
  }
}

export async function saveCompany(c: Company): Promise<void> {
  const value = {
    name: c.name.trim(),
    address: c.address.trim(),
    phone: c.phone.trim(),
    email: c.email.trim(),
    taxId: c.taxId.trim()
  }
  const { error } = await supabase
    .from('app_settings')
    .upsert({ key: 'company', value }, { onConflict: 'key' })
  if (error) throw new Error(error.message)
}

// The block printed at the top of the PDF reports: one line per item
export function companyHeaderText(c: Company, taxIdLabel: string): string {
  return [
    c.name,
    c.address,
    [c.phone, c.email].filter(Boolean).join(' · '),
    c.taxId ? `${taxIdLabel}: ${c.taxId}` : ''
  ]
    .filter((line) => line.trim() !== '')
    .join('\n')
}

// Default export language: remembered on this PC
const EXPORT_LANG_KEY = 'app.exportLang'

export function loadExportLang(fallback: Lang): Lang {
  try {
    const saved = localStorage.getItem(EXPORT_LANG_KEY)
    if (saved === 'en' || saved === 'fr' || saved === 'it') return saved
  } catch {
    /* ignore */
  }
  return fallback
}

export function saveExportLang(lang: Lang): void {
  try {
    localStorage.setItem(EXPORT_LANG_KEY, lang)
  } catch {
    /* ignore */
  }
}