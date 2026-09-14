import { useEffect, useState } from 'react'
import { getSales } from '../api/sales'
import {
  defaultSettings,
  getPublicSettings,
  type AppSettings,
} from '../api/settings'
import ErrorMessage from '../components/ErrorMessage'
import Loading from '../components/Loading'
import Receipt from '../components/Receipt'
import type { Sale } from '../types'
import { formatCurrency, formatDate, getApiErrorMessage } from '../utils/format'

export default function SalesPage() {
  const [sales, setSales] = useState<Sale[]>([])
  const [settings, setSettings] = useState<AppSettings>(defaultSettings)
  const [selectedSale, setSelectedSale] = useState<Sale | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  async function loadSales() {
    try {
      setError(null)
      const [salesData, settingsData] = await Promise.all([
        getSales(),
        getPublicSettings().catch(() => defaultSettings),
      ])
      setSales(salesData)
      setSettings(settingsData)
    } catch (err) {
      setError(getApiErrorMessage(err))
    } finally {
      setIsLoading(false)
    }
  }

  useEffect(() => {
    loadSales()
  }, [])

  function printTicket() {
    let finished = false
    const ticketWidth = settings.ticket_width === 58 ? '58mm' : '80mm'

    document.body.classList.add('ticket-print-mode')
    document.body.style.setProperty('--ticket-page-width', ticketWidth)

    const finish = () => {
      if (finished) return
      finished = true
      window.removeEventListener('afterprint', finish)
      document.body.classList.remove('ticket-print-mode')
      document.body.style.removeProperty('--ticket-page-width')
    }

    window.addEventListener('afterprint', finish)
    window.setTimeout(() => {
      window.print()
      window.setTimeout(finish, 1200)
    }, 100)
  }

  function printSale(sale: Sale) {
    setSelectedSale(sale)
    window.setTimeout(printTicket, 100)
  }

  return (
    <section>
      <div className="page-title">
        <div>
          <h2>Sales</h2>
          <p>Historique des ventes, détails et réimpression de ticket.</p>
        </div>
      </div>

      {isLoading ? <Loading label="Chargement des ventes..." /> : null}
      <ErrorMessage message={error} />

      {!isLoading && !error ? (
        sales.length ? (
          <div className="table-wrap panel">
            <table>
              <thead>
                <tr>
                  <th>Sale</th>
                  <th>User</th>
                  <th>Total</th>
                  <th>Profit</th>
                  <th>Payment</th>
                  <th>Date</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {sales.map((sale) => (
                  <tr key={sale.id}>
                    <td>#{sale.id}</td>
                    <td>{sale.user?.name ?? 'N/A'}</td>
                    <td>{formatCurrency(sale.total)}</td>
                    <td>{formatCurrency(sale.profit)}</td>
                    <td>{sale.payment_method}</td>
                    <td>{formatDate(sale.created_at)}</td>
                    <td>
                      <div className="table-actions">
                        <button
                          className="button secondary"
                          onClick={() => setSelectedSale(sale)}
                          type="button"
                        >
                          Details
                        </button>
                        <button
                          className="button"
                          onClick={() => printSale(sale)}
                          type="button"
                        >
                          Print
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="empty-state">Aucune vente.</div>
        )
      ) : null}

      {selectedSale ? (
        <div className="modal-backdrop" role="dialog" aria-modal="true">
          <div className="modal large-modal">
            <div className="panel-title">
              <h3>Vente #{selectedSale.id}</h3>
              <button
                className="button secondary"
                onClick={() => setSelectedSale(null)}
                type="button"
              >
                Fermer
              </button>
            </div>

            <div className="sale-detail-grid">
              <span>Total: {formatCurrency(selectedSale.total)}</span>
              <span>Profit: {formatCurrency(selectedSale.profit)}</span>
              <span>Paiement: {selectedSale.payment_method}</span>
              <span>Date: {formatDate(selectedSale.created_at)}</span>
              <span>Worker: {selectedSale.user?.name ?? 'N/A'}</span>
              <span>Note: {selectedSale.note ?? '-'}</span>
            </div>

            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Product</th>
                    <th>Qty</th>
                    <th>Unit</th>
                    <th>Total</th>
                  </tr>
                </thead>
                <tbody>
                  {selectedSale.items?.map((item) => (
                    <tr key={item.id}>
                      <td>{item.product?.name ?? `Produit #${item.product_id}`}</td>
                      <td>{item.quantity}</td>
                      <td>{formatCurrency(item.unit_price)}</td>
                      <td>{formatCurrency(item.total)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <Receipt sale={selectedSale} settings={settings} />

            <div className="modal-actions">
              <button className="button" onClick={printTicket} type="button">
                Print
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </section>
  )
}
