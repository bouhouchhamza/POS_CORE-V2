import assert from 'node:assert/strict'
import test from 'node:test'
import {
  isTouchKeyboardInputType,
  shouldRequestKeyboardForFocus,
} from './utils/touchKeyboard.ts'

test('touch keyboard accepts editable text and numeric input types', () => {
  for (const type of ['text', 'password', 'search', 'email', 'tel', 'url', 'number']) {
    assert.equal(isTouchKeyboardInputType(type), true, type)
  }
})

test('touch keyboard rejects non-editable input controls', () => {
  for (const type of ['button', 'checkbox', 'radio', 'range', 'file', 'hidden', 'submit']) {
    assert.equal(isTouchKeyboardInputType(type), false, type)
  }
})

test('focus requests the keyboard only on touch-capable hardware', () => {
  assert.equal(shouldRequestKeyboardForFocus(1), true)
  assert.equal(shouldRequestKeyboardForFocus(10), true)
  assert.equal(shouldRequestKeyboardForFocus(0), false)
  assert.equal(shouldRequestKeyboardForFocus(Number.NaN), false)
})
