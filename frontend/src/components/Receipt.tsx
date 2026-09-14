import type { CSSProperties } from 'react'
import { defaultSettings, type AppSettings } from '../api/settings'
import type { Sale, SaleItem, User } from '../types'

export type ReceiptSale = Partial<Omit<Sale, 'id' | 'items' | 'user'>> & {
  id?: number | string | null
  isDraft?: boolean
  user?: Partial<User> | null
  items?: ReceiptItem[]
}

type ReceiptItem = Partial<Omit<SaleItem, 'product'>> & {
  name?: string
  product_name?: string
  price?: number
  sale_price?: number
  product?: { name?: string | null } | null
}

type ReceiptProps = {
  sale: ReceiptSale
  settings?: AppSettings
  copyLabel?: string
  draftLabel?: string
}

function money(value: unknown) {
  const number = Number(value ?? 0)

  return number.toLocaleString('fr-FR', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })
}

function formatDate(value?: string) {
  if (!value) return ''

  return new Date(value).toLocaleDateString('fr-FR')
}

function formatTime(value?: string) {
  if (!value) return ''

  return new Date(value).toLocaleTimeString('fr-FR', {
    hour: '2-digit',
    minute: '2-digit',
  })
}

function getServerName(sale: ReceiptSale) {
  return sale.user?.name || 'Worker'
}

function getPaymentLabel(value?: string) {
  if (!value) return 'Espèces'
  if (value === 'cash') return 'Espèces'
  if (value === 'card') return 'Carte'
  return value
}

function getItemName(item: ReceiptItem) {
  return item.product?.name || item.product_name || item.name || 'Produit'
}

function getItemQuantity(item: ReceiptItem) {
  return Number(item.quantity ?? 0)
}

function getItemUnitPrice(item: ReceiptItem) {
  return Number(item.unit_price ?? item.price ?? item.sale_price ?? 0)
}

function getItemTotal(item: ReceiptItem) {
  return Number(item.total ?? getItemUnitPrice(item) * getItemQuantity(item))
}

export default function Receipt({
  copyLabel,
  draftLabel = 'Facture provisoire',
  sale,
  settings = defaultSettings,
}: ReceiptProps) {
  const items = sale.items ?? []
  const total =
    sale.total ?? items.reduce((sum, item) => sum + getItemTotal(item), 0)
  const printedAt = sale.created_at || new Date().toISOString()
  const ticketLabel = sale.isDraft ? draftLabel : `Ticket N° : ${sale.id ?? '-'}`
  const width = settings.ticket_width === 58 ? 58 : 80
  const widthStyle = { '--ticket-width': `${width}mm` } as CSSProperties
  const showWifi =
    settings.show_wifi_on_ticket &&
    Boolean(settings.wifi_name || settings.wifi_code)

  return (
    <div className={`ticket-print-area ticket-${width}`} style={widthStyle}>
      <div
        className={`ticket-paper ticket-${width} ticket-paper-${width}`}
        style={widthStyle}
      >
        <div className="ticket-brand">
          <span className="ticket-brand-main">
            {settings.ticket_header || settings.cafe_name}
          </span>
          {settings.cafe_subtitle ? (
            <span className="ticket-brand-sub">{settings.cafe_subtitle}</span>
          ) : null}
        </div>

        {copyLabel ? <div className="ticket-copy-label">{copyLabel}</div> : null}
        {sale.isDraft ? (
          <div className="ticket-draft-label">
            Facture provisoire - vérifier avant validation
          </div>
        ) : null}

        <div className="ticket-separator" />

        <div className="ticket-row">
          <span>
            <strong>{ticketLabel}</strong>
          </span>
          <span>
            <strong>Le</strong> {formatDate(printedAt)} {formatTime(printedAt)}
          </span>
        </div>

        <div className="ticket-server">
          <strong>Serveur :</strong> {getServerName(sale)}
        </div>

        <table className="ticket-table">
          <thead>
            <tr>
              <th>Désignation</th>
              <th>Qte</th>
              <th>PU</th>
              <th>Total</th>
            </tr>
          </thead>

          <tbody>
            {Array.isArray(items) ? items.map((item, index) => (
              <tr key={item.id ?? item.product_id ?? index}>
                <td>{getItemName(item)}</td>
                <td>{getItemQuantity(item)}</td>
                <td>{money(getItemUnitPrice(item))}</td>
                <td>{money(getItemTotal(item))}</td>
              </tr>
            )) : null}
          </tbody>
        </table>

        <div className="ticket-total">
          <span>Total à payer</span>
          <strong>{money(total)}</strong>
        </div>

        <div className="ticket-payment">
          <strong>Mode règlement :</strong> {getPaymentLabel(sale.payment_method)}
        </div>

        {sale.note ? <div className="ticket-note">{sale.note}</div> : null}

        {showWifi ? (
          <div className="ticket-block">
            {settings.wifi_name ? (
              <div className="ticket-wifi">
                <strong>WiFi :</strong>
                <span>{settings.wifi_name}</span>
              </div>
            ) : null}

            {settings.wifi_code ? (
              <div className="ticket-wifi">
                <strong>Code WiFi :</strong>
                <span>{settings.wifi_code}</span>
              </div>
            ) : null}
          </div>
        ) : null}

        <div className="ticket-footer">
          {settings.show_address_on_ticket && settings.cafe_address ? (
            <p>{settings.cafe_address}</p>
          ) : null}
          {settings.show_phone_on_ticket && settings.cafe_phone ? (
            <p>{settings.cafe_phone}</p>
          ) : null}
          {settings.ticket_note ? <p>{settings.ticket_note}</p> : null}
          <div className="ticket-separator" />
          {settings.ticket_footer ? <p>{settings.ticket_footer}</p> : null}
        </div>
      </div>
    </div>
  )
}
