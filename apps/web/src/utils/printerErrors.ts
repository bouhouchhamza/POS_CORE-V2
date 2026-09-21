export type PrinterErrorCode =
  | 'PRINTER_NOT_CONFIGURED'
  | 'PRINTER_NOT_FOUND'
  | 'PRINTER_OFFLINE'
  | 'PRINT_BRIDGE_UNAVAILABLE'
  | 'PRINT_PERMISSION_DENIED'
  | 'PRINT_FAILED'

const printerErrorCodes = new Set<PrinterErrorCode>([
  'PRINTER_NOT_CONFIGURED',
  'PRINTER_NOT_FOUND',
  'PRINTER_OFFLINE',
  'PRINT_BRIDGE_UNAVAILABLE',
  'PRINT_PERMISSION_DENIED',
  'PRINT_FAILED',
])

export class CorePosPrintError extends Error {
  code: PrinterErrorCode

  constructor(code: PrinterErrorCode, message = code) {
    super(message)
    this.name = 'CorePosPrintError'
    this.code = code
  }
}

function knownCode(value: unknown): PrinterErrorCode | null {
  return typeof value === 'string' && printerErrorCodes.has(value as PrinterErrorCode)
    ? value as PrinterErrorCode
    : null
}

export function getPrinterErrorCode(error: unknown): PrinterErrorCode {
  const candidate = error as {
    code?: unknown
    message?: unknown
    response?: { data?: { code?: unknown } }
  }
  const direct = knownCode(candidate?.response?.data?.code ?? candidate?.code)
  if (direct) return direct

  const text = typeof error === 'string'
    ? error
    : typeof candidate?.message === 'string'
      ? candidate.message
      : ''

  try {
    const parsed = JSON.parse(text) as { code?: unknown }
    const parsedCode = knownCode(parsed?.code)
    if (parsedCode) return parsedCode
  } catch {
    // Tauri may return a plain string on older desktop builds.
  }

  const normalized = text.toLowerCase()
  if (normalized.includes('no printer') || normalized.includes('aucune imprimante') || normalized.includes('غير مهي')) return 'PRINTER_NOT_CONFIGURED'
  if (normalized.includes('not found') || normalized.includes('introuvable')) return 'PRINTER_NOT_FOUND'
  if (normalized.includes('offline') || normalized.includes('hors connexion')) return 'PRINTER_OFFLINE'
  if (normalized.includes('permission') || normalized.includes('access denied')) return 'PRINT_PERMISSION_DENIED'
  if (normalized.includes('desktop') || normalized.includes('native printing')) return 'PRINT_BRIDGE_UNAVAILABLE'
  return 'PRINT_FAILED'
}

export function printErrorMessage(
  error: unknown,
  translate: (key: string) => string,
) {
  return translate(`print.error.${getPrinterErrorCode(error)}`)
}

export function printErrorDetail(
  error: unknown,
  translate: (key: string) => string,
) {
  return translate(`print.error.${getPrinterErrorCode(error)}.detail`)
}

export function isPrinterConfigurationError(error: unknown) {
  const code = getPrinterErrorCode(error)
  return code === 'PRINTER_NOT_CONFIGURED' || code === 'PRINTER_NOT_FOUND'
}
