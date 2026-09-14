import { Check } from 'lucide-react'
import { useI18n } from '../i18n'
import type { BusinessType } from '../types'
import { businessTypes } from './businessTypeConfig'

export default function BusinessTypeSelector({
  value,
  onChange,
}: {
  value: BusinessType
  onChange: (type: BusinessType) => void
}) {
  const { t } = useI18n()

  return (
    <div className="business-type-grid">
      {businessTypes.map((type) => {
        const Icon = type.icon
        const selected = value === type.id

        return (
          <button
            aria-pressed={selected}
            className={`business-type-card ${selected ? 'selected' : ''}`}
            key={type.id}
            onClick={() => onChange(type.id)}
            type="button"
          >
            <Icon aria-hidden="true" />
            <span>
              <strong>{t(`businessType.${type.id}.title`)}</strong>
              <small>{t(`businessType.${type.id}.description`)}</small>
            </span>
            {selected ? <Check aria-hidden="true" /> : null}
          </button>
        )
      })}
    </div>
  )
}
