import type { SalesReport } from '../types'
import { formatCurrency, formatDate } from '../utils/format'

type ReportPrintProps = {
  className: string
  report: SalesReport
  title: string
  periodLabel: string
}

function formatTime(value: string) {
  return new Intl.DateTimeFormat('fr-MA', {
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(value))
}

export default function ReportPrint({
  className,
  periodLabel,
  report,
  title,
}: ReportPrintProps) {
  return (
    <section className={`report-print ${className}`}>
      <header className="report-print-header">
        <h1>Bimik_Cafe</h1>
        <h2>{title}</h2>
        <p>{periodLabel}</p>
      </header>

      <div className="report-print-summary">
        <div>
          <span>Total ventes</span>
          <strong>{formatCurrency(report.total_sales)}</strong>
        </div>
        <div>
          <span>Nombre ventes/commandes</span>
          <strong>{report.total_orders}</strong>
        </div>
        <div>
          <span>Total produits vendus</span>
          <strong>{report.total_products_sold}</strong>
        </div>
      </div>

      <section className="report-print-section">
        <h3>Best products</h3>
        {report.best_products && Array.isArray(report.best_products) && report.best_products.length ? (
          <table>
            <thead>
              <tr>
                <th>Produit</th>
                <th>Quantite</th>
                <th>Total</th>
              </tr>
            </thead>
            <tbody>
              {report.best_products.map((product) => (
                <tr key={product.product_id}>
                  <td>{product.name}</td>
                  <td>{product.quantity}</td>
                  <td>{formatCurrency(product.total)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <p>Aucun produit vendu.</p>
        )}
      </section>

      <section className="report-print-section">
        <h3>Details des ventes</h3>
        {report.commandes && Array.isArray(report.commandes) && report.commandes.length ? (
          report.commandes.map((sale) => (
            <article className="report-sale" key={sale.id}>
              <div className="report-sale-head">
                <strong>Commande #{sale.id}</strong>
                <span>{formatDate(sale.created_at)}</span>
                <span>Heure: {formatTime(sale.created_at)}</span>
                <span>Caissier: {sale.user?.name ?? 'N/A'}</span>
              </div>

              <table>
                <thead>
                  <tr>
                    <th>Produit</th>
                    <th>Qte</th>
                    <th>Prix unitaire</th>
                    <th>Total ligne</th>
                  </tr>
                </thead>
                <tbody>
                  {sale.items && Array.isArray(sale.items) && sale.items.map((item) => (
                    <tr key={item.id}>
                      <td>{item.product?.name ?? `Produit #${item.product_id}`}</td>
                      <td>{item.quantity}</td>
                      <td>{formatCurrency(item.unit_price)}</td>
                      <td>{formatCurrency(item.total)}</td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr>
                    <td colSpan={3}>Total commande</td>
                    <td>{formatCurrency(sale.total)}</td>
                  </tr>
                </tfoot>
              </table>
            </article>
          ))
        ) : (
          <p>Aucune vente pour cette periode.</p>
        )}
      </section>
    </section>
  )
}
