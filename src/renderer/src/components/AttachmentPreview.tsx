import { useEffect, useState } from 'react'
import { displayName, fetchAttachment, isImage, saveAttachment } from '../lib/attachments'
import { useI18n } from '../i18n/I18nProvider'

interface Props {
  path: string
  onClose: () => void
}

export default function AttachmentPreview({ path, onClose }: Props): React.JSX.Element {
  const { t } = useI18n()
  const [url, setUrl] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const name = displayName(path)
  const image = isImage(path)

  useEffect(() => {
    let objectUrl: string | null = null
    let cancelled = false
    fetchAttachment(path).then(({ blob, error: err }) => {
      if (cancelled) return
      if (!blob) {
        setError(err ?? 'Could not open the file')
        return
      }
      objectUrl = URL.createObjectURL(blob)
      setUrl(objectUrl)
    })
    return () => {
      cancelled = true
      if (objectUrl) URL.revokeObjectURL(objectUrl)
    }
  }, [path])

  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  // Images: print through a hidden frame. (PDFs have their own Print button in the viewer.)
  function printImage(): void {
    if (!url) return
    const frame = document.createElement('iframe')
    Object.assign(frame.style, {
      position: 'fixed',
      right: '0',
      bottom: '0',
      width: '0',
      height: '0',
      border: '0'
    })
    document.body.appendChild(frame)
    const doc = frame.contentDocument
    const win = frame.contentWindow
    if (!doc || !win) return
    const img = doc.createElement('img')
    img.style.maxWidth = '100%'
    img.onload = () => {
      win.focus()
      win.print()
    }
    img.src = url
    doc.body.style.margin = '0'
    doc.body.appendChild(img)
    setTimeout(() => frame.remove(), 60_000)
  }

  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/70" onClick={onClose} />
      <div className="relative flex h-[90vh] w-[60rem] max-w-full flex-col rounded-xl bg-white shadow-2xl">
        <div className="flex items-center justify-between gap-3 border-b px-5 py-3">
          <h3 className="truncate font-bold text-slate-800">{name}</h3>
          <div className="flex shrink-0 gap-2">
            <button
              onClick={() => saveAttachment(path)}
              className="rounded-md border border-slate-300 px-3 py-1.5 text-sm hover:bg-slate-50"
            >
              {t('download')}
            </button>
            {image && (
              <button
                onClick={printImage}
                disabled={!url}
                className="rounded-md border border-slate-300 px-3 py-1.5 text-sm hover:bg-slate-50 disabled:opacity-50"
              >
                {t('print')}
              </button>
            )}
            <button
              onClick={onClose}
              aria-label={t('close')}
              className="rounded px-2 py-1 text-slate-500 hover:bg-slate-100"
            >
              ✕
            </button>
          </div>
        </div>

        <div className="flex-1 overflow-auto bg-slate-100">
          {!url && !error && (
            <p className="p-6 text-center text-slate-500">{t('loading')}</p>
          )}
          {error && <p className="m-4 rounded bg-red-50 p-3 text-sm text-red-700">{error}</p>}
          {url && image && (
            <div className="flex min-h-full items-center justify-center p-4">
              <img src={url} alt={name} className="max-h-full max-w-full object-contain" />
            </div>
          )}
          {url && !image && <iframe src={url} title={name} className="h-full w-full border-0" />}
        </div>

        {!image && <p className="border-t px-5 py-2 text-xs text-slate-500">{t('pdfHint')}</p>}
      </div>
    </div>
  )
}