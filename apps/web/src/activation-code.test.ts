import assert from 'node:assert/strict'
import test from 'node:test'
import {
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
