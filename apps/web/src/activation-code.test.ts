import assert from 'node:assert/strict'
import test from 'node:test'
import {
  activationErrorMessage,
  formatActivationCodeWhileTyping,
  normalizeActivationCodeInput,
} from './utils/activationCode.ts'

test('activation input formats the CP code without touching legacy credentials', () => {
  assert.equal(formatActivationCodeWhileTyping('cpabcdEFGHjkmnpqrs'), 'CP-ABCD-EFGH-JKMN-PQRS')
  assert.equal(formatActivationCodeWhileTyping('act_legacy-value'), 'act_legacy-value')
})

test('activation input accepts safe case and separator variations only for complete CP codes', () => {
  assert.equal(normalizeActivationCodeInput(' cp-abcd efgh-jkmn-pqrs '), 'CP-ABCD-EFGH-JKMN-PQRS')
  assert.equal(normalizeActivationCodeInput('CP-ABCD-EFGH-JKMN-PQRI'), 'CP-ABCD-EFGH-JKMN-PQRI')
})

test('activation errors use stable API codes rather than server text', () => {
  const translate = (key: string) => key
  assert.equal(
    activationErrorMessage({ response: { status: 409, data: { code: 'DEVICE_LIMIT_REACHED' } } }, translate),
    'license.error.deviceLimit',
  )
  assert.equal(
    activationErrorMessage({ response: { status: 409, data: { code: 'ACTIVATION_REPLAY' } } }, translate),
    'license.error.alreadyActivated',
  )
  assert.equal(
    activationErrorMessage({ response: { status: 410, data: { code: 'ACTIVATION_CODE_REVOKED' } } }, translate),
    'license.error.revoked',
  )
  assert.equal(
    activationErrorMessage({ response: { status: 503, data: { code: 'UNEXPECTED' } } }, translate),
    'license.error.serverUnavailable',
  )
})
