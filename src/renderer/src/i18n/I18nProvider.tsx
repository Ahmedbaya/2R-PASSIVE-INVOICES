import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'
import { LANGUAGES, translations, type Dictionary, type Lang } from './translations'

const STORAGE_KEY = 'app.lang'

interface I18nState {
  lang: Lang
  locale: string
  setLang: (lang: Lang) => void
  t: (key: keyof Dictionary) => string
}

const I18nContext = createContext<I18nState | null>(null)

function initialLang(): Lang {
  try {
    const saved = localStorage.getItem(STORAGE_KEY)
    if (saved === 'en' || saved === 'fr' || saved === 'it') return saved
  } catch {
    /* ignore */
  }
  const nav = navigator.language.slice(0, 2).toLowerCase()
  return nav === 'fr' || nav === 'it' ? nav : 'en'
}

export function I18nProvider({ children }: { children: ReactNode }): React.JSX.Element {
  const [lang, setLangState] = useState<Lang>(initialLang)

  useEffect(() => {
    document.documentElement.lang = lang
  }, [lang])

  const value = useMemo<I18nState>(() => {
    const dict = translations[lang]
    return {
      lang,
      locale: LANGUAGES.find((l) => l.code === lang)!.locale,
      setLang: (l: Lang) => {
        setLangState(l)
        try {
          localStorage.setItem(STORAGE_KEY, l)
        } catch {
          /* ignore */
        }
      },
      t: (key) => dict[key]
    }
  }, [lang])

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>
}

export function useI18n(): I18nState {
  const ctx = useContext(I18nContext)
  if (!ctx) throw new Error('useI18n must be used inside I18nProvider')
  return ctx
}