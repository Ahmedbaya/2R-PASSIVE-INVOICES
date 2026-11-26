import { useI18n } from './I18nProvider'
import { LANGUAGES, type Lang } from './translations'

export default function LanguageSwitcher(): React.JSX.Element {
  const { lang, setLang, t } = useI18n()
  return (
    <select
      aria-label={t('language')}
      title={t('language')}
      value={lang}
      onChange={(e) => setLang(e.target.value as Lang)}
      className="rounded bg-slate-600 px-2 py-1 text-sm text-white outline-none"
    >
      {LANGUAGES.map((l) => (
        <option key={l.code} value={l.code}>
          {l.label}
        </option>
      ))}
    </select>
  )
}