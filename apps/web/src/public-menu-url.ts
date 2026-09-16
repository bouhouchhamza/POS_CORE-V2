const LOCAL_OR_DESKTOP_ORIGIN = /^(?:tauri:\/\/|https?:\/\/(?:tauri\.localhost|localhost|127\.0\.0\.1)(?::\d+)?)$/i

export function publicMenuUrl(token: string, configuredOrigin: string | undefined, currentOrigin: string) {
  const configured = String(configuredOrigin ?? '').trim().replace(/\/$/, '')
  const browserOrigin = LOCAL_OR_DESKTOP_ORIGIN.test(currentOrigin) ? '' : currentOrigin.replace(/\/$/, '')
  const origin = configured || browserOrigin
  if (!origin || !/^https?:\/\//i.test(origin)) throw new Error('Origine publique QR non configurée.')
  if (!/^[A-Za-z0-9_-]{32,200}$/.test(token)) throw new Error('Jeton QR invalide.')
  return `${origin}/m/${encodeURIComponent(token)}`
}
