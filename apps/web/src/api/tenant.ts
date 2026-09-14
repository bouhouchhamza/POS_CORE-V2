export const WORKSPACE_KEY = 'bimik_workspace_slug'

const WORKSPACE_PATTERN = /^[a-z0-9](?:[a-z0-9-]{0,78}[a-z0-9])?$/

export function normalizeWorkspaceSlug(value: string | null | undefined) {
  const slug = String(value ?? '').trim().toLowerCase()
  return WORKSPACE_PATTERN.test(slug) ? slug : null
}

export function getWorkspaceSlug() {
  if (typeof window === 'undefined') return null
  try {
    return normalizeWorkspaceSlug(window.localStorage.getItem(WORKSPACE_KEY))
  } catch {
    return null
  }
}

export function setWorkspaceSlug(value: string) {
  const slug = normalizeWorkspaceSlug(value)
  if (!slug) throw new Error('Invalid workspace identifier.')
  if (typeof window !== 'undefined') {
    window.localStorage.setItem(WORKSPACE_KEY, slug)
  }
  return slug
}

export function clearWorkspaceSlug() {
  if (typeof window === 'undefined') return
  try {
    window.localStorage.removeItem(WORKSPACE_KEY)
  } catch {
    // Storage can be unavailable in private/restricted browser contexts.
  }
}
