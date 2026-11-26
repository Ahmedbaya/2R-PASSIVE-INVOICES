import { useI18n } from '../i18n/I18nProvider'
import type { Dictionary } from '../i18n/translations'
import type { InvoiceStatus } from '../lib/types'

const STYLES: Record<InvoiceStatus, string> = {
  UNPAID: 'bg-blue-100 text-blue-800',
  OVERDUE: 'bg-red-600 text-white',
  PARTIAL: 'bg-amber-100 text-amber-800',
  PARTIAL_OVERDUE: 'bg-red-100 text-red-700 ring-1 ring-red-400',
  PAID: 'bg-green-100 text-green-800',
  VOID: 'bg-slate-200 text-slate-600'
}

export default function StatusBadge({ status }: { status: InvoiceStatus }): React.JSX.Element {
  const { t } = useI18n()
  const late = status === 'OVERDUE' || status === 'PARTIAL_OVERDUE'
  return (
    <span
      className={`inline-block whitespace-nowrap rounded-full px-2.5 py-0.5 text-xs font-semibold ${STYLES[status]}`}
    >
      {late && '⚠ '}
      {t(`status_${status}` as keyof Dictionary)}
    </span>
  )
}