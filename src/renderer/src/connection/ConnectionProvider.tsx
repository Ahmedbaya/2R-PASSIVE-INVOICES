import { createContext, useContext, useEffect, useState, type ReactNode } from 'react'
import { supabase } from '../lib/supabase'

type Status = 'connecting' | 'ready' | 'error'

interface ConnectionState {
  status: Status
  error: string | null
  retry: () => void
}

export const MISSING_CREDENTIALS = 'MISSING_CREDENTIALS'

const APP_EMAIL = import.meta.env.RENDERER_VITE_APP_EMAIL as string | undefined
const APP_PASSWORD = import.meta.env.RENDERER_VITE_APP_PASSWORD as string | undefined

const ConnectionContext = createContext<ConnectionState | null>(null)

// Signs in silently with the company account. The user never sees a login form.
export function ConnectionProvider({ children }: { children: ReactNode }): React.JSX.Element {
  const [status, setStatus] = useState<Status>('connecting')
  const [error, setError] = useState<string | null>(null)
  const [attempt, setAttempt] = useState(0)

  useEffect(() => {
    let cancelled = false

    async function connect(): Promise<void> {
      setStatus('connecting')
      setError(null)

      const { data } = await supabase.auth.getSession()
      if (cancelled) return
      if (data.session) {
        setStatus('ready')
        return
      }

      if (!APP_EMAIL || !APP_PASSWORD) {
        setError(MISSING_CREDENTIALS)
        setStatus('error')
        return
      }

      const { error: err } = await supabase.auth.signInWithPassword({
        email: APP_EMAIL,
        password: APP_PASSWORD
      })
      if (cancelled) return
      if (err) {
        setError(err.message)
        setStatus('error')
      } else {
        setStatus('ready')
      }
    }

    connect()
    return () => {
      cancelled = true
    }
  }, [attempt])

  // If the session is ever lost (for example a failed token refresh), reconnect silently
  useEffect(() => {
    const { data: sub } = supabase.auth.onAuthStateChange((event) => {
      if (event === 'SIGNED_OUT') setAttempt((a) => a + 1)
    })
    return () => sub.subscription.unsubscribe()
  }, [])

  return (
    <ConnectionContext.Provider value={{ status, error, retry: () => setAttempt((a) => a + 1) }}>
      {children}
    </ConnectionContext.Provider>
  )
}

export function useConnection(): ConnectionState {
  const ctx = useContext(ConnectionContext)
  if (!ctx) throw new Error('useConnection must be used inside ConnectionProvider')
  return ctx
}