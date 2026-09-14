type LoadingProps = {
  label?: string
}

export default function Loading({ label }: LoadingProps) {
  const { t } = useI18n()
  return (
    <div className="loading" role="status" aria-live="polite">
      <span className="spinner" aria-hidden="true" />
      {label ?? t('common.loading')}
    </div>
  )
}
import { useI18n } from '../i18n'
