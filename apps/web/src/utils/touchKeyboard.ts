const EDITABLE_INPUT_TYPES = new Set([
  'email',
  'number',
  'password',
  'search',
  'tel',
  'text',
  'url',
])

export function isTouchKeyboardInputType(type: string) {
  return EDITABLE_INPUT_TYPES.has(type.trim().toLowerCase())
}

export function shouldRequestKeyboardForFocus(maxTouchPoints: number) {
  return Number.isFinite(maxTouchPoints) && maxTouchPoints > 0
}

function isTauriDesktop() {
  return typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window
}

export function isTouchKeyboardTarget(target: EventTarget | null) {
  if (!(target instanceof Element)) return false

  const element = target.closest('input, textarea, [contenteditable]')
  if (!element) return false

  if (element instanceof HTMLInputElement) {
    return !element.disabled && !element.readOnly && isTouchKeyboardInputType(element.type)
  }

  if (element instanceof HTMLTextAreaElement) {
    return !element.disabled && !element.readOnly
  }

  return element instanceof HTMLElement && element.isContentEditable
}

export function installTouchKeyboard() {
  if (!isTauriDesktop()) return () => undefined

  let lastRequest = 0
  const requestKeyboard = (target: EventTarget | null) => {
    if (!isTouchKeyboardTarget(target)) return

    const current = Date.now()
    if (current - lastRequest < 400) return
    lastRequest = current

    void import('@tauri-apps/api/core')
      .then(({ invoke }) => invoke('show_touch_keyboard'))
      .catch(() => undefined)
  }

  const onFocus = (event: FocusEvent) => {
    if (shouldRequestKeyboardForFocus(navigator.maxTouchPoints)) {
      requestKeyboard(event.target)
    }
  }
  const onPointer = (event: PointerEvent) => {
    if (event.isPrimary && (event.pointerType === 'touch' || event.pointerType === 'pen')) {
      requestKeyboard(event.target)
    }
  }

  document.addEventListener('focusin', onFocus, true)
  document.addEventListener('pointerdown', onPointer, true)

  return () => {
    document.removeEventListener('focusin', onFocus, true)
    document.removeEventListener('pointerdown', onPointer, true)
  }
}
