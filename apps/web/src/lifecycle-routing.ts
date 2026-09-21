import type { LifecycleState } from './api/core-v2'

export type LifecycleRoute =
  | { kind: 'redirect'; to: '/activation' | '/login' | '/dashboard' | '/setup' }
  | { kind: 'render' }
  | { kind: 'notice' }

/**
 * Maps the server-authoritative lifecycle state to one deterministic browser
 * outcome. This intentionally consumes no historical setup booleans.
 */
export function routeForLifecycle(
  state: LifecycleState,
  pathname: string,
): LifecycleRoute {
  if (state === 'READY_FOR_ACTIVATION') {
    return pathname === '/activation'
      ? { kind: 'render' }
      : { kind: 'redirect', to: '/activation' }
  }

  if (state === 'DEVICE_ACTIVATED') {
    return pathname === '/login'
      ? { kind: 'render' }
      : { kind: 'redirect', to: '/login' }
  }

  if (state === 'READY') {
    return pathname === '/activation' || pathname === '/setup' || pathname === '/login'
      ? { kind: 'redirect', to: '/dashboard' }
      : { kind: 'render' }
  }

  if (state === 'SETUP_REQUIRED') {
    return pathname === '/setup'
      ? { kind: 'render' }
      : { kind: 'redirect', to: '/setup' }
  }

  return { kind: 'notice' }
}
