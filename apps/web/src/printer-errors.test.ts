import assert from 'node:assert/strict'
import test from 'node:test'
import {
  CorePosPrintError,
  getPrinterErrorCode,
  isPrinterConfigurationError,
} from './utils/printerErrors.ts'

for (const code of ['PRINTER_NOT_CONFIGURED','PRINTER_NOT_FOUND','PRINTER_OFFLINE','PRINT_BRIDGE_UNAVAILABLE','PRINT_PERMISSION_DENIED','PRINT_FAILED'] as const) {
  test(`maps ${code} from structured print errors`, () => {
    assert.equal(getPrinterErrorCode(new CorePosPrintError(code)), code)
  })
}

test('maps legacy Tauri payloads and keeps unexpected failures distinguishable', () => {
  assert.equal(getPrinterErrorCode('{"code":"PRINTER_NOT_FOUND","message":"hidden"}'), 'PRINTER_NOT_FOUND')
  assert.equal(getPrinterErrorCode(new Error('unexpected spooler state')), 'PRINT_FAILED')
  assert.equal(isPrinterConfigurationError(new CorePosPrintError('PRINTER_NOT_CONFIGURED')), true)
  assert.equal(isPrinterConfigurationError(new CorePosPrintError('PRINTER_OFFLINE')), false)
})
