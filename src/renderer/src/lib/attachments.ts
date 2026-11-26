import { supabase } from './supabase'

export const BUCKET = 'invoice-attachments'
export const MAX_BYTES = 10 * 1024 * 1024 // 10 MB, same limit as the bucket

const MIME_BY_EXT: Record<string, string> = {
  pdf: 'application/pdf',
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg'
}

export const NOT_ALLOWED = 'NOT_ALLOWED'

function extOf(name: string): string {
  const i = name.lastIndexOf('.')
  return i < 0 ? '' : name.slice(i + 1).toLowerCase()
}

export function mimeFor(name: string): string | null {
  return MIME_BY_EXT[extOf(name)] ?? null
}

export function isImage(name: string): boolean {
  const m = mimeFor(name)
  return m === 'image/png' || m === 'image/jpeg'
}

export type FileCheck = 'ok' | 'type' | 'size'

export function checkFile(file: File): FileCheck {
  if (!mimeFor(file.name)) return 'type'
  if (file.size > MAX_BYTES) return 'size'
  return 'ok'
}

// "<invoiceId>/1736000000000-scan_facture.pdf"  ->  "scan_facture.pdf"
export function displayName(path: string): string {
  const base = path.split('/').pop() ?? path
  return base.replace(/^\d+-/, '')
}

// Storage keys must not contain accents, spaces or special characters
function safeName(name: string): string {
  return name
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^A-Za-z0-9._-]+/g, '_')
    .slice(-80)
}

// Uploads the file, links it to the invoice, then deletes the previous file.
// Returns null on success, or an error message.
export async function uploadAttachment(
  invoiceId: string,
  file: File,
  oldPath: string | null
): Promise<string | null> {
  const mime = mimeFor(file.name)
  if (!mime) return 'Unsupported file type'
  const path = `${invoiceId}/${Date.now()}-${safeName(file.name)}`

  const up = await supabase.storage.from(BUCKET).upload(path, file, {
    contentType: mime,
    upsert: false
  })
  if (up.error) return up.error.message

  const { data, error } = await supabase
    .from('purchase_invoices')
    .update({ attachment_path: path })
    .eq('id', invoiceId)
    .select('id')

  if (error || !data || data.length === 0) {
    await supabase.storage.from(BUCKET).remove([path]) // do not leave an orphan file
    return error ? error.message : NOT_ALLOWED
  }

  if (oldPath) await supabase.storage.from(BUCKET).remove([oldPath])
  return null
}

export async function removeAttachment(invoiceId: string, path: string): Promise<string | null> {
  const { data, error } = await supabase
    .from('purchase_invoices')
    .update({ attachment_path: null })
    .eq('id', invoiceId)
    .select('id')
  if (error) return error.message
  if (!data || data.length === 0) return NOT_ALLOWED
  await supabase.storage.from(BUCKET).remove([path])
  return null
}

// Downloads the file from the private bucket into memory
export async function fetchAttachment(
  path: string
): Promise<{ blob: Blob | null; error: string | null }> {
  const { data, error } = await supabase.storage.from(BUCKET).download(path)
  if (error || !data) return { blob: null, error: error?.message ?? 'Download failed' }
  return { blob: new Blob([data], { type: mimeFor(path) ?? data.type }), error: null }
}

// Saves the file to the computer (Electron shows the "Save as" window)
export async function saveAttachment(path: string): Promise<string | null> {
  const { blob, error } = await fetchAttachment(path)
  if (!blob) return error
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = displayName(path)
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 60_000)
  return null
}