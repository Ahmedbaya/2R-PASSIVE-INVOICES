import { createClient } from '@supabase/supabase-js'

const url = import.meta.env.RENDERER_VITE_SUPABASE_URL as string
const key = import.meta.env.RENDERER_VITE_SUPABASE_ANON_KEY as string

// Session is stored encrypted by the OS (Electron safeStorage), not in localStorage
const secureStorage = {
  getItem: (k: string) => window.api.secureStorage.get(k),
  setItem: async (k: string, v: string) => {
    await window.api.secureStorage.set(k, v)
  },
  removeItem: async (k: string) => {
    await window.api.secureStorage.remove(k)
  }
}

// ---------- Read-only mode (connection lost) ----------
let readOnly = false
export function setReadOnly(value: boolean): void {
  readOnly = value
}

const READ_ONLY_MESSAGES: Record<string, string> = {
  en: 'Connection lost — read-only mode. Changes are disabled until the connection returns.',
  fr: "Connexion perdue — mode lecture seule. Les modifications sont désactivées jusqu'au retour de la connexion.",
  it: 'Connessione persa — modalità sola lettura. Le modifiche sono disattivate fino al ritorno della connessione.'
}

function readOnlyMessage(): string {
  let lang = 'en'
  try {
    const saved = localStorage.getItem('app.lang')
    if (saved === 'fr' || saved === 'it') lang = saved
  } catch {
    /* ignore */
  }
  return READ_ONLY_MESSAGES[lang]
}

// Is this request a change to the data? (reading, login and token refresh are always allowed)
function isWrite(input: RequestInfo | URL, init?: RequestInit): boolean {
  const method = (init?.method ?? (input instanceof Request ? input.method : 'GET')).toUpperCase()
  if (method === 'GET' || method === 'HEAD' || method === 'OPTIONS') return false
  const target = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
  if (target.includes('/auth/v1/')) return false
  if (target.includes('/rest/v1/rpc/')) return target.includes('/rest/v1/rpc/import_legacy_ledger')
  return target.includes('/rest/v1/') || target.includes('/storage/v1/')
}

const guardedFetch: typeof fetch = (input, init) => {
  if (readOnly && isWrite(input, init)) {
    return Promise.resolve(
      new Response(JSON.stringify({ message: readOnlyMessage(), code: 'READ_ONLY' }), {
        status: 503,
        headers: { 'Content-Type': 'application/json' }
      })
    )
  }
  return fetch(input, init)
}

// Is the database reachable? Any answer below 500 means yes.
export async function pingServer(): Promise<boolean> {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), 5000)
  try {
    const res = await fetch(`${url}/auth/v1/health`, {
      headers: { apikey: key },
      signal: controller.signal,
      cache: 'no-store'
    })
    return res.status < 500
  } catch {
    return false
  } finally {
    clearTimeout(timeout)
  }
}

export const supabase = createClient(url, key, {
  auth: {
    storage: secureStorage,
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: false
  },
  global: { fetch: guardedFetch }
})