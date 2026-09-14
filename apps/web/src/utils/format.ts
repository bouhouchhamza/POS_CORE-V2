export const currencyFormatter = new Intl.NumberFormat('fr-MA', {
  style: 'currency',
  currency: 'MAD',
  maximumFractionDigits: 2,
})

export function formatCurrency(value: number | string | null | undefined) {
  const numberValue = Number(value ?? 0)
  return currencyFormatter.format(Number.isFinite(numberValue) ? numberValue : 0)
}

export function formatDate(value: string | null | undefined) {
  if (!value) return '-'

  return new Intl.DateTimeFormat('fr-MA', {
    dateStyle: 'short',
    timeStyle: 'short',
  }).format(new Date(value))
}

export function getApiErrorMessage(error: unknown) {
  if (
    typeof error === 'object' &&
    error !== null &&
    'response' in error &&
    typeof error.response === 'object' &&
    error.response !== null &&
    'data' in error.response
  ) {
    const data = error.response.data as {
      message?: string
      errors?: Record<string, string[]>
    }

    const firstValidationError = data.errors
      ? Object.values(data.errors).flat()[0]
      : undefined

    return firstValidationError || data.message || 'Une erreur est survenue.'
  }

  if (error instanceof Error) return error.message

  return 'Une erreur est survenue.'
}
