import { useCallback, useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { CURRENCIES, formatMoney, type Currency } from '../lib/format'
import { useI18n } from '../i18n/I18nProvider'

interface Kpi {
  currency: Currency
  total_invoiced: number
  total_paid: number
  remaining_to_pay: number
  invoice_count: number
}

interface Alert {
  currency: Currency
  overdue_count: number
  overdue_amount: number
  due_7d_count: number
  due_7d_amount: number
}

export default function Dashboard(): React.JSX.Element {
  const { t, locale } = useI18n()
  const [kpis, setKpis] = useState<Kpi[]>([])
  const [alerts, setAlerts] = useState<Alert[]>([])
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    const [k, a] = await Promise.all([
      supabase.rpc('dashboard_kpis'),
      supabase.rpc('payables_alerts')
    ])
    if (k.error || a.error) {
      setError((k.error ?? a.error)!.message)
    } else {
      setKpis(k.data as Kpi[])
      setAlerts(a.data as Alert[])
    }
    setLoading(false)
  }, [])

  useEffect(() => {
    load()
  }, [load])

  const byCurrency = <T extends { currency: Currency }>(rows: T[], c: Currency): T | undefined =>
    rows.find((r) => r.currency === c)

  const hasAlerts = alerts.some((a) => a.overdue_count > 0 || a.due_7d_count > 0)

  return (
    <div className="mx-auto max-w-6xl p-6">
      <div className="mb-4 flex items-center justify-between">
        <h2 className="text-2xl font-bold text-slate-800">{t('dashboard')}</h2>
        <button
          onClick={load}
          className="rounded-md border border-slate-300 bg-white px-3 py-1.5 text-sm hover:bg-slate-50"
        >
          {t('refresh')}
        </button>
      </div>

      {error && (
        <p className="mb-4 rounded bg-red-50 p-3 text-sm text-red-700">
          {t('loadError')}: {error}
        </p>
      )}

      {/* Payables alert bar */}
      {!error && !loading && (
        <div
          className={`mb-6 rounded-lg border p-4 ${
            hasAlerts ? 'border-red-300 bg-red-50' : 'border-green-300 bg-green-50'
          }`}
        >
          {hasAlerts ? (
            <div className="space-y-1 text-sm">
              {CURRENCIES.map((c) => {
                const a = byCurrency(alerts, c)
                if (!a || (a.overdue_count === 0 && a.due_7d_count === 0)) return null
                return (
                  <div key={c} className="flex flex-wrap gap-x-6">
                    <span className="w-10 font-bold">{c}</span>
                    <span className="text-red-700">
                      {t('overdue')}: {a.overdue_count} ({formatMoney(a.overdue_amount, c, locale)})
                    </span>
                    <span className="text-amber-700">
                      {t('dueIn7Days')}: {a.due_7d_count} (
                      {formatMoney(a.due_7d_amount, c, locale)})
                    </span>
                  </div>
                )
              })}
            </div>
          ) : (
            <p className="text-sm text-green-800">{t('noAlerts')}</p>
          )}
        </div>
      )}

      {/* Three independent currency summaries: currencies are never added together */}
      <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
        {CURRENCIES.map((c) => {
          const k = byCurrency(kpis, c)
          const remaining = Number(k?.remaining_to_pay ?? 0)
          return (
            <div key={c} className="rounded-xl bg-white p-5 shadow">
              <div className="mb-3 flex items-baseline justify-between">
                <h3 className="text-lg font-bold text-slate-800">{c}</h3>
                <span className="text-xs text-slate-500">
                  {t('documents')}: {k?.invoice_count ?? 0}
                </span>
              </div>
              <dl className="space-y-2 text-sm">
                <div className="flex justify-between gap-2">
                  <dt className="text-slate-500">{t('totalInvoiced')}</dt>
                  <dd className="font-semibold">{formatMoney(k?.total_invoiced ?? 0, c, locale)}</dd>
                </div>
                <div className="flex justify-between gap-2">
                  <dt className="text-slate-500">{t('totalPaid')}</dt>
                  <dd className="font-semibold">{formatMoney(k?.total_paid ?? 0, c, locale)}</dd>
                </div>
                <div className="flex justify-between gap-2 border-t pt-2">
                  <dt className="text-slate-500">{t('remainingToPay')}</dt>
                  <dd className={remaining > 0 ? 'font-bold text-red-600' : 'font-semibold'}>
                    {formatMoney(remaining, c, locale)}
                  </dd>
                </div>
              </dl>
            </div>
          )
        })}
      </div>
    </div>
  )
}