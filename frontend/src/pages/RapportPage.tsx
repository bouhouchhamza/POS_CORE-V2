import { useEffect, useState } from 'react'
import { getMonthlyReport } from '../api/reports'
import ErrorMessage from '../components/ErrorMessage'
import Loading from '../components/Loading'
import ReportPrint from '../components/ReportPrint'
import type { SalesReport } from '../types'
import { formatCurrency, formatDate, getApiErrorMessage } from '../utils/format'

function currentMonthValue() {
  const now = new Date()
  const month = String(now.getMonth() + 1).padStart(2, '0')

  return `${now.getFullYear()}-${month}`
}

export default function RapportPage() {
  const [month, setMonth] = useState(currentMonthValue)
  const [report, setReport] = useState<SalesReport | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const [shouldPrintMonthlyReport, setShouldPrintMonthlyReport] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let mounted = true

    async function loadReport() {
      try {
        setError(null)
        setIsLoading(true)
        const data = await getMonthlyReport(month)
        if (mounted) setReport(data)
      } catch (err) {
        if (mounted) setError(getApiErrorMessage(err))
      } finally {
        if (mounted) setIsLoading(false)
      }
    }

    loadReport()

    return () => {
      mounted = false
    }
  }, [month])

  useEffect(() => {
    if (!shouldPrintMonthlyReport) return

    const handleAfterPrint = () => setShouldPrintMonthlyReport(false)
    const timeout = window.setTimeout(() => window.print(), 50)

    window.addEventListener('afterprint', handleAfterPrint)

    return () => {
      window.clearTimeout(timeout)
      window.removeEventListener('afterprint', handleAfterPrint)
    }
  }, [shouldPrintMonthlyReport])

  return (
    <section>
      <div className="page-title">
        <div>
          <h2>Rapport</h2>
          <p>Rapport mensuel des ventes et commandes.</p>
        </div>

        <div className="page-title-actions no-print">
          <label className="month-picker">
            Mois
            <input
              type="month"
              value={month}
              onChange={(event) => setMonth(event.target.value)}
            />
          </label>
          <button
            className="button secondary"
            disabled={!report || isLoading}
            onClick={() => setShouldPrintMonthlyReport(true)}
            type="button"
          >
            Imprimer
          </button>
        </div>
      </div>

      {isLoading ? <Loading label="Chargement du rapport..." /> : null}
      <ErrorMessage message={error} />

      {report && !isLoading && !error ? (
        <>
          <section className="panel monthly-report">
            <div className="panel-title">
              <h3>Rapport dyal dak chher</h3>
              <span>{report.period.month ?? month}</span>
            </div>

            <div className="report-stats">
              <article>
                <span>Total ventes dyal chher</span>
                <strong>{formatCurrency(report.total_sales)}</strong>
              </article>
              <article>
                <span>Nombre commandes</span>
                <strong>{report.total_orders}</strong>
              </article>
              <article>
                <span>Produits vendus</span>
                <strong>{report.total_products_sold}</strong>
              </article>
            </div>

            <div className="best-products">
              <h4>Best products dyal dak chher</h4>
              {report.best_products.length ? (
                <div className="mini-list">
                  {report.best_products.map((product) => (
                    <div key={product.product_id}>
                      <span>{product.name}</span>
                      <strong>
                        {product.quantity} - {formatCurrency(product.total)}
                      </strong>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="empty-state">Ma kaynach ventes f had chher.</div>
              )}
            </div>
          </section>

          <section className="panel">
            <div className="panel-title">
              <h3>Commandes dyal dak chher</h3>
              <span>{report.commandes.length}</span>
            </div>

            {report.commandes.length ? (
              <div className="table-wrap">
                <table>
                  <thead>
                    <tr>
                      <th>Commande</th>
                      <th>Total</th>
                      <th>Paiement</th>
                      <th>Date</th>
                      <th>Produits</th>
                    </tr>
                  </thead>
                  <tbody>
                    {report.commandes.map((sale) => (
                      <tr key={sale.id}>
                        <td>#{sale.id}</td>
                        <td>{formatCurrency(sale.total)}</td>
                        <td>{sale.payment_method}</td>
                        <td>{formatDate(sale.created_at)}</td>
                        <td>
                          {sale.items?.length
                            ? sale.items
                                .map(
                                  (item) =>
                                    `${item.product?.name ?? `Produit #${item.product_id}`} x ${item.quantity}`,
                                )
                                .join(', ')
                            : '-'}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <div className="empty-state">Aucune commande f had chher.</div>
            )}
          </section>
        </>
      ) : null}

      {shouldPrintMonthlyReport && report ? (
        <ReportPrint
          className="monthly-report-print"
          periodLabel={report.period.month ?? month}
          report={report}
          title="Rapport mensuel"
        />
      ) : null}
    </section>
  )
}
