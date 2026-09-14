import api from './client'

export type AppSettings = {
  cafe_name: string
  cafe_subtitle: string
  cafe_address: string
  cafe_phone: string
  wifi_name: string
  wifi_code: string
  ticket_header: string
  ticket_footer: string
  ticket_note: string
  show_wifi_on_ticket: boolean
  show_phone_on_ticket: boolean
  show_address_on_ticket: boolean
  ticket_width: 58 | 80
  auto_print_after_order: boolean
  open_ticket_after_order: boolean
  thermal_printer_name: string
  direct_print_enabled: boolean
  fallback_browser_print: boolean
}

export const defaultSettings: AppSettings = {
  cafe_name: 'Bimik_Cafe',
  cafe_subtitle: 'Stock & caisse',
  cafe_address: 'HAY ADRAR',
  cafe_phone: '',
  wifi_name: 'Bimik_Cafe',
  wifi_code: '',
  ticket_header: 'BIMIK Café Bimik',
  ticket_footer: 'NOUS VOUS REMERCIONS POUR VOTRE VISITE',
  ticket_note: '',
  show_wifi_on_ticket: true,
  show_phone_on_ticket: false,
  show_address_on_ticket: true,
  ticket_width: 80,
  auto_print_after_order: false,
  open_ticket_after_order: true,
  thermal_printer_name: '',
  direct_print_enabled: false,
  fallback_browser_print: false,
}

export type PublicSettings = AppSettings

function normalizeSettings(payload: Partial<AppSettings>): AppSettings {
  return {
    ...defaultSettings,
    ...payload,
    ticket_width: payload.ticket_width === 58 ? 58 : 80,
    show_wifi_on_ticket: Boolean(
      payload.show_wifi_on_ticket ?? defaultSettings.show_wifi_on_ticket,
    ),
    show_phone_on_ticket: Boolean(
      payload.show_phone_on_ticket ?? defaultSettings.show_phone_on_ticket,
    ),
    show_address_on_ticket: Boolean(
      payload.show_address_on_ticket ?? defaultSettings.show_address_on_ticket,
    ),
    auto_print_after_order: Boolean(
      payload.auto_print_after_order ?? defaultSettings.auto_print_after_order,
    ),
    open_ticket_after_order: Boolean(
      payload.open_ticket_after_order ?? defaultSettings.open_ticket_after_order,
    ),
    thermal_printer_name:
      payload.thermal_printer_name ?? defaultSettings.thermal_printer_name,
    direct_print_enabled: Boolean(
      payload.direct_print_enabled ?? defaultSettings.direct_print_enabled,
    ),
    fallback_browser_print: Boolean(
      payload.fallback_browser_print ?? defaultSettings.fallback_browser_print,
    ),
  }
}

export async function getSettings() {
  const response = await api.get<AppSettings>('/settings')

  return normalizeSettings(response.data)
}

export async function updateSettings(payload: AppSettings) {
  const response = await api.put<AppSettings>('/settings', payload)

  return normalizeSettings(response.data)
}

export async function getPublicSettings() {
  const response = await api.get<AppSettings>('/settings/public')

  return normalizeSettings(response.data)
}

export async function updateWifiSettings(
  payload: Pick<AppSettings, 'wifi_name' | 'wifi_code'>,
) {
  const response = await api.put<Pick<AppSettings, 'wifi_name' | 'wifi_code'>>(
    '/settings/wifi',
    payload,
  )

  return response.data
}
