import { useEffect, useRef, useState, type DragEvent } from 'react'
import type { LedgerRow } from '../lib/types'
import {
  NOT_ALLOWED,
  checkFile,
  displayName,
  fetchAttachment,
  isImage,
  removeAttachment,
  saveAttachment,
  uploadAttachment
} from '../lib/attachments'
import { useI18n } from '../i18n/I18nProvider'
import AttachmentPreview from './AttachmentPreview'

interface Props {
  invoice: LedgerRow
  onChanged: () => void
  onPreviewChange?: (open: boolean) => void
}

export default function AttachmentSection({
  invoice,
  onChanged,
  onPreviewChange
}: Props): React.JSX.Element {
  const { t } = useI18n()
  const path = invoice.attachment_path
  const disabled = invoice.is_void

  const [busy, setBusy] = useState(false)
  const [dragging, setDragging] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [preview, setPreview] = useState(false)
  const [thumb, setThumb] = useState<string | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    onPreviewChange?.(preview)
  }, [preview, onPreviewChange])

  // Small inline preview for images
  useEffect(() => {
    let url: string | null = null
    let cancelled = false
    setThumb(null)
    if (path && isImage(path)) {
      fetchAttachment(path).then(({ blob }) => {
        if (blob && !cancelled) {
          url = URL.createObjectURL(blob)
          setThumb(url)
        }
      })
    }
    return () => {
      cancelled = true
      if (url) URL.revokeObjectURL(url)
    }
  }, [path])

  const message = (err: string): string => (err === NOT_ALLOWED ? t('errNotAllowed') : err)

  async function handleFile(file: File | undefined): Promise<void> {
    if (!file || disabled) return
    setError(null)
    const check = checkFile(file)
    if (check === 'type') return setError(t('errFileType'))
    if (check === 'size') return setError(t('errFileSize'))

    setBusy(true)
    const err = await uploadAttachment(invoice.id, file, path)
    setBusy(false)
    if (err) setError(message(err))
    else onChanged()
  }

  async function handleRemove(): Promise<void> {
    if (!path || !window.confirm(t('removeFileConfirm'))) return
    setBusy(true)
    setError(null)
    const err = await removeAttachment(invoice.id, path)
    setBusy(false)
    if (err) setError(message(err))
    else onChanged()
  }

  async function handleDownload(): Promise<void> {
    if (!path) return
    const err = await saveAttachment(path)
    if (err) setError(err)
  }

  function onDrop(e: DragEvent): void {
    e.preventDefault()
    setDragging(false)
    handleFile(e.dataTransfer.files?.[0])
  }

  const btn =
    'rounded-md border border-slate-300 bg-white px-3 py-1.5 text-sm hover:bg-slate-50 disabled:opacity-50'

  return (
    <div>
      <h4 className="mb-2 text-sm font-bold uppercase text-slate-600">{t('attachment')}</h4>

      <input
        ref={inputRef}
        type="file"
        hidden
        accept=".pdf,.png,.jpg,.jpeg,application/pdf,image/png,image/jpeg"
        onChange={(e) => {
          handleFile(e.target.files?.[0])
          e.target.value = '' // lets the user pick the same file again
        }}
      />

      <div
        onDragOver={(e) => {
          e.preventDefault()
          if (!disabled) setDragging(true)
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={onDrop}
        className={`rounded-lg border-2 border-dashed p-4 text-sm ${
          dragging ? 'border-blue-500 bg-blue-50' : 'border-slate-300 bg-slate-50'
        }`}
      >
        {!path ? (
          <button
            type="button"
            disabled={busy || disabled}
            onClick={() => inputRef.current?.click()}
            className="block w-full py-4 text-center text-slate-500 hover:text-blue-700 disabled:opacity-60"
          >
            {busy ? t('uploading') : `📎 ${t('dropHere')}`}
          </button>
        ) : (
          <div className="space-y-3">
            <div className="flex items-center gap-3">
              {thumb ? (
                <img
                  src={thumb}
                  alt=""
                  onClick={() => setPreview(true)}
                  className="h-20 w-20 cursor-pointer rounded border object-cover"
                />
              ) : (
                <div className="flex h-20 w-20 shrink-0 items-center justify-center rounded border bg-white text-3xl">
                  📄
                </div>
              )}
              <div className="min-w-0">
                <p className="truncate font-medium text-slate-800">{displayName(path)}</p>
                <p className="text-xs text-slate-500">
                  {busy ? t('uploading') : t('dropToReplace')}
                </p>
              </div>
            </div>
            <div className="flex flex-wrap gap-2">
              <button type="button" onClick={() => setPreview(true)} className={btn}>
                {t('preview')}
              </button>
              <button type="button" onClick={handleDownload} className={btn}>
                {t('download')}
              </button>
              <button
                type="button"
                disabled={busy || disabled}
                onClick={() => inputRef.current?.click()}
                className={btn}
              >
                {t('replaceFile')}
              </button>
              <button
                type="button"
                disabled={busy || disabled}
                onClick={handleRemove}
                className={`${btn} text-red-700`}
              >
                {t('removeFile')}
              </button>
            </div>
          </div>
        )}
      </div>

      {error && <p className="mt-2 rounded bg-red-50 p-2 text-sm text-red-700">{error}</p>}

      {preview && path && <AttachmentPreview path={path} onClose={() => setPreview(false)} />}
    </div>
  )
}