import { useEffect, useRef, useState } from 'react'
import { pingServer, setReadOnly } from '../lib/supabase'
import { useI18n } from '../i18n/I18nProvider'

type State = 'online' | 'offline' | 'restored'

export default function ConnectionBanner({
  onReload
}: {
  onReload: () => void
}): React.JSX.Element | null {
  const { t } = useI18n()
  const [state, setState] = useState<State>('online')
  const offlineRef = useRef(false)

  useEffect(() => {
    let cancelled = false
    let checking = false
    let failures = 0
    let timer: ReturnType<typeof setTimeout> | undefined

    const apply = (offline: boolean): void => {
      if (offline === offlineRef.current) return
      offlineRef.current = offline
      setReadOnly(offline)
      setState(offline ? 'offline' : 'restored')
    }

    async function check(): Promise<void> {
      if (checking) return
      checking = true
      const ok = await pingServer()
      checking = false
      if (cancelled) return
      if (ok) {
        failures = 0
        apply(false)
      } else {
        failures++
        if (failures >= 2 || !navigator.onLine) apply(true)
      }
      timer = setTimeout(check, offlineRef.current ? 4000 : 10000)
    }

    const onOffline = (): void => apply(true)
    const onOnline = (): void => {
      if (timer) clearTimeout(timer)
      void check()
    }

    window.addEventListener('offline', onOffline)
    window.addEventListener('online', onOnline)
    timer = setTimeout(check, 10000)

    return () => {
      cancelled = true
      if (timer) clearTimeout(timer)
      window.removeEventListener('offline', onOffline)
      window.removeEventListener('online', onOnline)
      setReadOnly(false)
    }
  }, [])

  // The green "restored" message disappears by itself
  useEffect(() => {
    if (state !== 'restored') return
    const id = setTimeout(() => setState('online'), 20000)
    return () => clearTimeout(id)
  }, [state])

  if (state === 'offline') {
    return (
      <div role="alert" className="bg-red-600 px-4 py-2 text-sm font-medium text-white">
        ⚠ {t('connLost')}
      </div>
    )
  }

  if (state === 'restored') {
    return (
      <div className="flex items-center justify-between gap-3 bg-green-600 px-4 py-2 text-sm text-white">
        <span>✓ {t('connRestored')}</span>
        <button
          onClick={() => {
            onReload()
            setState('online')
          }}
          className="rounded bg-white/20 px-3 py-1 hover:bg-white/30"
        >
          {t('reloadData')}
        </button>
      </div>
    )
  }

  return null
}